# VuTV Launcher

Custom Google TV-style launcher cho LG Smart TV đã root (webOS 4.0+).

![webOS 4.0](https://img.shields.io/badge/webOS-4.0%2B-blue)
![License](https://img.shields.io/badge/license-AGPL--v3-green)

## Tính năng

- 🎨 Giao diện tối, Google TV-style
- 📱 Grid app lớn, letter badge màu dựa theo `iconColor` của từng app
- ⭐ Yêu thích (nhấn giữ OK hoặc nút đỏ) — lưu vào localStorage
- 🕒 Gần đây — tự ghi nhận app vừa mở
- 🕐 Đồng hồ realtime
- 🎮 Điều hướng bằng D-pad remote
- 🚀 Tự khởi động cùng TV
- 🧹 Script tối ưu TV đi kèm (ad-block, cache clear, memory)

## Giới hạn

- **Icon app**: webOS 4.0 dev app không truy cập được `file://` tới icon system apps — dùng letter badge màu thay thế
- **Home button**: webOS không cho phép thay thế hành vi nút Home. Vào launcher từ stock home bar (chọn tile "VuTV Launcher") hoặc set auto-start khi boot
- **App list**: bundled trong `apps-config.json` tại build time — scan lại TV nếu cài thêm app mới (chạy `scripts/scan-apps.sh` trên TV)

## Yêu cầu

- LG Smart TV đã root ([dejavuln-autoroot](https://github.com/throwaway96/dejavuln-autoroot))
- [Homebrew Channel](https://github.com/webosbrew/webos-homebrew-channel)
- SSH hoặc telnet enabled
- webOS 4.0+

## Cài đặt

### Qua telnet (port 23, no auth)

```bash
# Build IPK
cd webos-launcher
python3 scripts/build-ipk.py  # creates com.vutv.launcher_1.0.0_all.ipk

# Serve files via HTTP from your computer
python3 -m http.server 8888 &

# From TV telnet, pull and install
telnet <TV_IP>
# Then:
# curl -o /tmp/launcher.ipk http://<YOUR_IP>:8888/com.vutv.launcher_1.0.0_all.ipk
# luna-send -w 15000 -i 'luna://com.webos.appInstallService/dev/install' '{"id":"com.ares.defaultName","ipkUrl":"/tmp/launcher.ipk","subscribe":true}'
```

### Qua SSH (nếu cấu hình)

```bash
scp -r webos-launcher root@<TV_IP>:/tmp/vutv-launcher
ssh root@<TV_IP> 'sh /tmp/vutv-launcher/scripts/install.sh'
```

## Launch

```bash
luna-send -n 1 'luna://com.webos.applicationManager/launch' '{"id":"com.vutv.launcher"}'
```

Hoặc chọn tile "VuTV Launcher" trong stock home bar.

## Tối ưu TV

```bash
sh scripts/optimize-tv.sh
```

Xóa cache, chặn domain quảng cáo LG qua `/etc/hosts`, tắt service thừa, free RAM, tắt auto-update.

## Scan lại apps-config.json

Khi cài thêm app mới trên TV:

```bash
# Trên TV (telnet)
luna-send -n 1 'luna://com.webos.applicationManager/listApps' '{}' > /tmp/applist.json
nc <YOUR_IP> 9000 < /tmp/applist.json

# Trên máy
nc -l 9000 > applist.json
python3 scripts/parse-apps.py applist.json > apps-config.json
```

## Điều khiển

| Nút | Chức năng |
|-----|-----------|
| ◀▶▲▼ | Di chuyển |
| OK | Mở app |
| OK (giữ) | Toggle yêu thích |
| Nút đỏ | Toggle yêu thích |
| Back | Về đầu trang |

## Cấu trúc

```
webos-launcher/
├── appinfo.json          # webOS app manifest
├── index.html            # Trang chính
├── apps-config.json      # Danh sách app bundled
├── css/style.css         # Google TV dark theme
├── js/app.js             # Luna integration + navigation
└── scripts/
    ├── install.sh        # Cài đặt
    └── optimize-tv.sh    # Tối ưu TV
```

## Tùy chỉnh

### Đổi màu accent

Sửa `--accent` trong `css/style.css`:

```css
:root {
    --accent: #8AB4F8;      /* Xanh Google (default) */
    /* --accent: #F28B82; */  /* Đỏ */
    /* --accent: #81C995; */  /* Xanh lá */
    /* --accent: #FDD663; */  /* Vàng */
}
```

### Ẩn app

Thêm vào mảng `HIDDEN_APPS` trong `js/app.js` hoặc remove khỏi `apps-config.json`.

## License

AGPL v3 — xem [COPYING](../COPYING).
