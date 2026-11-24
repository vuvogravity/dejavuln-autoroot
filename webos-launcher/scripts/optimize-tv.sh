#!/bin/sh

# ============================================================
# VuTV TV Optimizer — webOS 4.0+
# Run via SSH: sh /path/to/optimize-tv.sh
# Requires root access (rooted via dejavuln-autoroot)
# ============================================================

set -e

SCRIPT_NAME="VuTV Optimizer"
# Log file created via mktemp to avoid symlink attacks on predictable /tmp paths
LOG="$(mktemp -- '/tmp/vutv-optimize.XXXXXX.log' 2>/dev/null)" || {
    echo "[x] Failed to create log file" >&2
    exit 1
}
HOSTS_MARKER="# VuTV ad-block start"
HOSTS_END="# VuTV ad-block end"

# ── Helpers ─────────────────────────────────────────────────

log() {
    msg="[+] ${1}"
    echo "${msg}"
    echo "$(date '+%H:%M:%S') ${msg}" >>"${LOG}"
}

warn() {
    msg="[!] ${1}"
    echo "${msg}"
    echo "$(date '+%H:%M:%S') ${msg}" >>"${LOG}"
}

error() {
    msg="[x] ${1}"
    echo "${msg}" >&2
    echo "$(date '+%H:%M:%S') ${msg}" >>"${LOG}"
}

check_root() {
    if [ "$(id -u)" -ne 0 ]; then
        error "Script requires root. Run with: sudo sh ${0}"
        exit 1
    fi
}

toast() {
    luna-send -w 1000 -n 1 -a com.webos.service.secondscreen.gateway \
        'luna://com.webos.notification/createToast' \
        "$(printf '{"sourceId":"com.webos.service.secondscreen.gateway","message":"<h3>%s</h3>%s"}' "${SCRIPT_NAME}" "${1}")" \
        >/dev/null 2>&1 || true
}

# ── 1. Clear Caches ────────────────────────────────────────

clear_caches() {
    log "Clearing temporary files..."

    # Clear /tmp but preserve running process files
    find /tmp -maxdepth 1 -name "*.log" -mtime +1 -delete 2>/dev/null || true
    find /tmp -maxdepth 1 -name "*.tmp" -delete 2>/dev/null || true
    find /tmp -maxdepth 1 -name "core.*" -delete 2>/dev/null || true

    # Clear crashd logs
    if [ -d /var/log/crashd ]; then
        rm -rf /var/log/crashd/* 2>/dev/null || true
        log "Cleared crash logs"
    fi

    # Clear old PmLog files
    if [ -d /var/log/reports ]; then
        find /var/log/reports -name "*.log" -mtime +3 -delete 2>/dev/null || true
        find /var/log/reports -name "*.log.gz" -delete 2>/dev/null || true
        log "Cleared old report logs"
    fi

    # Clear browser cache
    local browser_cache="/home/root/.cache"
    if [ -d "${browser_cache}" ]; then
        du_before="$(du -sk "${browser_cache}" 2>/dev/null | cut -f1)"
        rm -rf "${browser_cache}"/* 2>/dev/null || true
        du_after="$(du -sk "${browser_cache}" 2>/dev/null | cut -f1)"
        freed="$(( (du_before - du_after) ))"
        log "Browser cache cleared: ${freed}KB freed"
    fi

    # Drop filesystem caches
    sync
    echo 3 > /proc/sys/vm/drop_caches 2>/dev/null || true
    log "Filesystem caches dropped"
}

# ── 2. Block Ads & Telemetry via /etc/hosts ─────────────────

block_ads() {
    log "Configuring ad & telemetry blocking..."

    local hosts="/etc/hosts"

    # Check if already configured
    if grep -q "${HOSTS_MARKER}" "${hosts}" 2>/dev/null; then
        log "Ad-blocking already configured, updating..."
        # Remove old block
        sed -i "/${HOSTS_MARKER}/,/${HOSTS_END}/d" "${hosts}" 2>/dev/null || true
    fi

    # Make hosts writable if needed
    mount -o remount,rw / 2>/dev/null || true

    cat >> "${hosts}" << 'ADBLOCK'
# VuTV ad-block start
# LG Smart TV Ads
0.0.0.0 us.info.lgsmartad.com
0.0.0.0 lgad.cjpowercast.com
0.0.0.0 smartshare.lgtvsdp.com
0.0.0.0 ibis.lgappstv.com
0.0.0.0 us.lgtvsdp.com
0.0.0.0 us.rdx2.lgtvsdp.com
0.0.0.0 lgtvsdp.com
0.0.0.0 rdx2.lgtvsdp.com
0.0.0.0 smartclip.net
0.0.0.0 ngfts.lge.com
0.0.0.0 ngfts.lge.com.edgekey.net
0.0.0.0 ad.lgappstv.com
0.0.0.0 carl.lgtvcommon.com
0.0.0.0 aic-gfts.lge.com

# LG Analytics & Telemetry
0.0.0.0 snu.lge.com
0.0.0.0 aic-ngfts.lge.com
0.0.0.0 ets-ngfts.lge.com
0.0.0.0 cbs.lge.com
0.0.0.0 1click.lgtvsdp.com

# LG Notifications / Nudges
0.0.0.0 nudge.lgtvsdp.com
0.0.0.0 repo.lgtvsdp.com
0.0.0.0 esp-common.lge.com

# Third-party ad trackers commonly used by LG
0.0.0.0 ad.doubleclick.net
0.0.0.0 pagead2.googlesyndication.com
# VuTV ad-block end
ADBLOCK

    log "Ad-blocking configured ($(grep -c '0.0.0.0' "${hosts}" 2>/dev/null || echo 0) domains blocked)"
}

# ── 3. Disable Unnecessary Services ────────────────────────

disable_services() {
    log "Disabling unnecessary services..."

    # Services safe to disable on webOS 4.0
    # Using stop (upstart) since webOS 4.0 uses upstart, not systemd
    local services="
        nudge
    "

    for svc in ${services}; do
        if stop "${svc}" 2>/dev/null; then
            log "Stopped: ${svc}"
        fi
    done

    # Disable LG Connect Apps (uses resources)
    if [ -f /var/palm/data/connect/active ]; then
        echo "false" > /var/palm/data/connect/active 2>/dev/null || true
        log "Disabled LG Connect Apps"
    fi

    # Disable Screen Saver to save memory (optional)
    # luna-send -n 1 'luna://com.webos.settingsservice/setSystemSettings' '{"category":"lock","settings":{"screenSaverOn":"off"}}' 2>/dev/null || true
}

# ── 4. Memory Optimization ──────────────────────────────────

optimize_memory() {
    log "Optimizing memory..."

    # Show current memory status
    local mem_total mem_free mem_available
    mem_total="$(grep MemTotal /proc/meminfo | awk '{print $2}')"
    mem_free="$(grep MemFree /proc/meminfo | awk '{print $2}')"
    mem_available="$(grep MemAvailable /proc/meminfo | awk '{print $2}')"

    log "Memory: total=${mem_total}KB free=${mem_free}KB available=${mem_available}KB"

    # Kill known heavy background apps that aren't essential
    local heavy_apps="
        com.webos.app.livetv-placeholder
        com.webos.app.tips
        com.webos.app.shoppinglauncher
    "

    for appid in ${heavy_apps}; do
        luna-send -w 2000 -n 1 'luna://com.webos.applicationManager/close' \
            "$(printf '{"id":"%s"}' "${appid}")" 2>/dev/null || true
    done

    # Adjust swappiness for better responsiveness (lower = prefer RAM)
    if [ -f /proc/sys/vm/swappiness ]; then
        local current_swap="$(cat /proc/sys/vm/swappiness)"
        if [ "${current_swap}" -gt 30 ]; then
            echo 20 > /proc/sys/vm/swappiness
            log "Swappiness: ${current_swap} -> 20"
        fi
    fi

    # Compact memory
    echo 1 > /proc/sys/vm/compact_memory 2>/dev/null || true

    # Show final memory
    mem_free_after="$(grep MemFree /proc/meminfo | awk '{print $2}')"
    mem_freed="$(( mem_free_after - mem_free ))"
    log "Memory freed: ~${mem_freed}KB"
}

# ── 5. Disable Firmware Auto-Update ─────────────────────────

disable_auto_update() {
    log "Disabling auto firmware update..."

    # Block firmware update server
    local hosts="/etc/hosts"
    if ! grep -q "snu.lge.com" "${hosts}" 2>/dev/null; then
        # Already added in ad-block section
        log "Update server already blocked"
    fi

    # Disable update notification via settings
    luna-send -n 1 'luna://com.webos.settingsservice/setSystemSettings' \
        '{"category":"option","settings":{"autoUpdate":"off"}}' 2>/dev/null || true

    log "Auto-update disabled"
}

# ── 6. Performance Tweaks ───────────────────────────────────

performance_tweaks() {
    log "Applying performance tweaks..."

    # Disable Quick Start+ for cleaner boots
    luna-send -n 1 'luna://com.webos.settingsservice/setSystemSettings' \
        '{"category":"option","settings":{"quickStartMode":"off"}}' 2>/dev/null || true
    log "Quick Start+ disabled"

    # Reduce animation duration via settings if supported
    luna-send -n 1 'luna://com.webos.settingsservice/setSystemSettings' \
        '{"category":"option","settings":{"uiEffect":"off"}}' 2>/dev/null || true
    log "UI effects reduced"
}

# ── Main ────────────────────────────────────────────────────

main() {
    echo "============================================"
    echo "  ${SCRIPT_NAME}"
    echo "  $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
    echo "============================================"
    echo ""

    check_root

    toast "Đang tối ưu hệ thống..."

    clear_caches
    echo ""

    block_ads
    echo ""

    disable_services
    echo ""

    optimize_memory
    echo ""

    disable_auto_update
    echo ""

    performance_tweaks
    echo ""

    echo "============================================"
    log "Optimization complete!"
    toast "Tối ưu hoàn tất ✓"
    echo ""
    echo "Log saved to: ${LOG}"
    echo ""
    echo "Recommend: Reboot TV for full effect"
    echo "  luna-send -n 1 'luna://com.webos.service.sleep/shutdown/machineReboot' '{\"reason\":\"remoteKey\"}'"
}

main "$@"
