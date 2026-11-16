# 🛡️ ZedRay VPN Client (Windows)

> **Sing-box 1.14.4** yadrosi va rasmiy **WinTun** virtual tarmoq drayveri asosida Windows uchun maxsus ishlab chiqilgan, uzilishlarsiz ishlovchi ultra-barqaror VPN & Proxy mijozi.

Ushbu ilova Hiddify va ZedSecure mobil/desktop ilovalari interfeysi uslubida yaratilgan bo'lib, VLESS Reality protokoli hamda obuna havolalarini (subscriptions) to'liq qo'llab-quvvatlaydi.

---

## ⚡ Nega Hiddify Windows'da uzilib qoladi va bu ilova uni qanday hal qiladi?

| Muammo (Hiddify/Boshqa ilovalar) | Sababi | Bu ilovadagi yechim (Senior Architecture) |
| :--- | :--- | :--- |
| **Doimiy uzilishlar (Drops)** | Standart MTU 1500 Reality enkapsulyatsiyasida paketlarni parchalab (fragmentation) tashlaydi. | **MTU 1400 / 1280:** Optimal MTU o'rnatilgan, paketlar parchalanmaydi. |
| **Qotib qolish (Routing Loop)** | TUN yoqilganda serverning o'z IP-si ham TUN ichiga tushib, aylanma tiqilish hosil qiladi. | **Direct Server IP Bypass:** Server IP avtomatik aniqlanib, to'g'ridan-to'g'ri marshrutlanadi. |
| **Uyqudan keyin internet yo'qolishi** | Notebook qopqog'i yopilganda Wi-Fi uzilib, TUN drayveri qotib qoladi. | **Auto-Reconnect Watchdog:** Orqa fonda har 6 soniyada tekshirib, uzilsa 1 soniyada avtomatik tiklaydi. |
| **DNS oqishi (DNS Leaks)** | Windows ko'p tarmoqli DNS so'rovlarida provayder DNS'iga ulanib qoladi. | **Strict DoH (1.1.1.1):** DNS so'rovlari shifrlangan holda faqat tunnel orqali o'tadi. |
| **Avast / Antivirus ziddiyati** | Antiviruslarning "Web Shield / HTTPS Scanning" funksiyasi Reality uTLS ulanishlarini uzib qo'yadi. | Tizimda antivirus aniqlanganda ogohlantirish beradi va istisnolarga qo'shishni eslatadi. |

---

## 🎨 Interfeys imkoniyatlari

- 📱 **ZedSecure / Hiddify Premium Dark UI:** To'liq qora mavzu (Obsidian Dark), zamonaviy kartalar va yorqin ranglar.
- 🚀 **Auto Fastest Server:** Barcha serverlarni bir vaqtda ping qilib, eng tezkori orqali ulanadi.
- 📊 **Obuna Kartasi (MultiCo VPN uslubi):** Sarflangan trafik, qolgan kunlar va bir tugma bilan yangilash.
- ⚡ **Real-vaqt Ping Testi:** Yashil (`<90ms`), sariq (`<200ms`), qizil (`>200ms`) indikatorlar.
- 🛠️ **TUN Mode & System Proxy:** Foydalanuvchi xohishiga ko'ra to'liq VPN (TUN) yoki Brauzer proksi (System Proxy) rejimini tanlash.

---

## 🔒 GitHub Xavfsizlik Siyosati (Zero Secret Leakage)

Ushbu loyiha ochiq kodli (Open Source) tarzda GitHub'ga yuklanishi uchun to'liq xavfsiz holatga keltirilgan:
1. **Shaxsiy serverlar va kalitlar saqlanmaydi:** Barcha VLESS linklar, obuna ma'lumotlari `data/servers.json` faylida saqlanadi va `.gitignore` orqali git nazoratidan chiqarilgan.
2. **Ikkilik fayllar (binaries) ajratilgan:** `sing-box.exe` va `wintun.dll` git tarixiga yuklanmaydi, repozitoriy yengil va toza qoladi.
3. Repozitoriyda faqat xavfsiz `config.example.json` shabloni mavjud.

---

## 🚀 Ishga tushirish (Windows)

### 1-Usul: Bitta bosish bilan (Tavsiya etiladi)
Ilova papkasidagi **`ZedVPN.bat`** faylini ikki marta bosing. Dastur orqa fonda serverni ishga tushiradi va mustaqil dastur oynasida ochiladi!

### 2-Usul: Terminal orqali
```bash
# Loyiha papkasiga o'ting
cd nexus-vpn

# Dasturni ishga tushiring
node launch.js
```

---

## 📦 GitHub'ga ulash (Push to GitHub)

Loyihangizni o'z GitHub hisobingizga yuklash uchun terminalda quyidagi buyruqlarni bajaring:

```bash
cd nexus-vpn
git init
git add .
git commit -m "feat: initial commit of Zed Secure VPN Windows client"
git branch -M main
git remote add origin https://github.com/<SIZNING_USERNAME>/zed-vpn-desktop.git
git push -u origin main
```

*(Diqqat: `.gitignore` avtomatik ravishda barcha shaxsiy konfiguratsiyalaringizni himoyalaydi, hech qanday IP yoki parol GitHub'ga chiqib ketmaydi).*

---

## ⚙️ Texnik stak
- **Core:** SagerNet `sing-box v1.14.4` (Go)
- **Virtual Network Driver:** Official `WinTun`
- **Backend / Daemon:** Node.js v24 (Zero external dependencies)
- **Frontend:** Material 3, HTML5, CSS3 Glassmorphism, Vanilla JS
- **Window Wrapper:** Native Microsoft Edge App Container
