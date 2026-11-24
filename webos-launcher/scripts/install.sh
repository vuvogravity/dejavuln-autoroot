#!/bin/sh

# ============================================================
# VuTV Launcher — Install Script
# Run on TV via SSH or from USB
# ============================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${0}")/.." && pwd)"
APP_ID="com.vutv.launcher"
APP_DIR="/media/developer/apps/usr/palm/applications/${APP_ID}"
SERVICE_DIR="/media/developer/apps/usr/palm/services/${APP_ID}.service"
IPK_PATH=""

log() { echo "[+] ${1}"; }
error() { echo "[x] ${1}" >&2; exit 1; }

check_root() {
    [ "$(id -u)" -eq 0 ] || error "Requires root"
}

# Method 1: Direct file copy (simple, works always)
install_direct() {
    log "Installing via direct copy..."

    # Create app directory
    mkdir -p "${APP_DIR}"

    # Copy files
    cp "${SCRIPT_DIR}/appinfo.json" "${APP_DIR}/"
    cp "${SCRIPT_DIR}/index.html" "${APP_DIR}/"
    cp -r "${SCRIPT_DIR}/css" "${APP_DIR}/"
    cp -r "${SCRIPT_DIR}/js" "${APP_DIR}/"

    # Copy icons if they exist
    for icon in icon_80.png icon_130.png; do
        if [ -f "${SCRIPT_DIR}/${icon}" ]; then
            cp "${SCRIPT_DIR}/${icon}" "${APP_DIR}/"
        fi
    done

    # Set permissions
    chmod -R 755 "${APP_DIR}"

    # Register the app with applicationManager
    luna-send -w 5000 -n 1 'luna://com.webos.appInstallService/dev/install' \
        "$(printf '{"id":"%s","ipkUrl":"%s","subscribe":false}' "${APP_ID}" "${APP_DIR}")" \
        2>/dev/null || true

    # Alternative: scan for new apps
    luna-send -w 3000 -n 1 'luna://com.webos.applicationManager/dev/listApps' '{}' \
        >/dev/null 2>&1 || true

    log "App installed at ${APP_DIR}"
}

# Method 2: via IPK if ares-package was used
install_ipk() {
    local ipk="${1}"
    log "Installing IPK: ${ipk}"

    # Ensure devmode_enabled exists
    if [ ! -d '/var/luna/preferences/devmode_enabled' ]; then
        mkdir -p '/var/luna/preferences/devmode_enabled'
    fi

    local payload
    payload="$(printf '{"id":"com.ares.defaultName","ipkUrl":"%s","subscribe":true}' "${ipk}")"

    # Private tempdir (mode 0700) to avoid symlink attacks on predictable /tmp paths
    local tmpdir
    tmpdir="$(mktemp -d -- '/tmp/vutv-install.XXXXXX')" || error "mktemp failed"
    local fifo="${tmpdir}/fifo"
    if ! mkfifo "${fifo}"; then
        rm -rf "${tmpdir}"
        error "mkfifo failed"
    fi

    luna-send -w 20000 -i 'luna://com.webos.appInstallService/dev/install' "${payload}" >"${fifo}" &
    local pid="${!}"

    if result="$(grep -m 1 -e 'installed' -e 'failed' -e 'Unknown method' "${fifo}")"; then
        case "${result}" in
            *installed*) log "IPK installed successfully" ;;
            *) error "Installation failed: ${result}" ;;
        esac
    else
        error "Installation timed out"
    fi

    kill "${pid}" 2>/dev/null || true
    rm -rf "${tmpdir}"
}

# Setup auto-launch on boot
setup_autostart() {
    log "Configuring auto-start..."

    local init_dir="/var/lib/webosbrew/init.d"
    local startup_script="${init_dir}/start-vutv-launcher"

    mkdir -p "${init_dir}"

    cat > "${startup_script}" << 'EOF'
#!/bin/sh
# Auto-launch VuTV Launcher on boot
# Wait for system to be ready
sleep 8
luna-send -n 1 'luna://com.webos.applicationManager/launch' '{"id":"com.vutv.launcher"}'
EOF

    chmod 755 "${startup_script}"
    log "Auto-start configured: ${startup_script}"
}

# Run optimizer
run_optimizer() {
    local opt_script="${SCRIPT_DIR}/scripts/optimize-tv.sh"
    if [ -f "${opt_script}" ]; then
        log "Running optimizer..."
        sh "${opt_script}"
    fi
}

# ── Main ────────────────────────────────────────────────────

usage() {
    echo "Usage: ${0} [options]"
    echo ""
    echo "Options:"
    echo "  --ipk FILE      Install from IPK file"
    echo "  --no-autostart  Don't configure auto-launch"
    echo "  --optimize      Also run TV optimizer"
    echo "  --uninstall     Remove VuTV Launcher"
    echo "  -h, --help      Show this help"
}

uninstall() {
    log "Uninstalling VuTV Launcher..."

    # Remove app
    luna-send -w 5000 -n 1 'luna://com.webos.appInstallService/dev/remove' \
        "$(printf '{"id":"%s","subscribe":false}' "${APP_ID}")" \
        2>/dev/null || true

    rm -rf "${APP_DIR}" 2>/dev/null || true

    # Remove autostart
    rm -f "/var/lib/webosbrew/init.d/start-vutv-launcher" 2>/dev/null || true

    log "Uninstalled"
}

main() {
    local do_autostart=true
    local do_optimize=false

    while [ $# -gt 0 ]; do
        case "${1}" in
            --ipk)
                IPK_PATH="${2}"
                shift 2
                ;;
            --no-autostart)
                do_autostart=false
                shift
                ;;
            --optimize)
                do_optimize=true
                shift
                ;;
            --uninstall)
                check_root
                uninstall
                exit 0
                ;;
            -h|--help)
                usage
                exit 0
                ;;
            *)
                error "Unknown option: ${1}"
                ;;
        esac
    done

    check_root

    echo "============================================"
    echo "  VuTV Launcher Installer"
    echo "============================================"
    echo ""

    if [ -n "${IPK_PATH}" ]; then
        install_ipk "${IPK_PATH}"
    else
        install_direct
    fi

    if ${do_autostart}; then
        setup_autostart
    fi

    if ${do_optimize}; then
        run_optimizer
    fi

    echo ""
    log "Installation complete!"
    echo ""
    echo "Launch now:"
    echo "  luna-send -n 1 'luna://com.webos.applicationManager/launch' '{\"id\":\"com.vutv.launcher\"}'"
    echo ""
    echo "Or reboot TV for auto-start."
}

main "$@"
