# Social Switcher

將 Codex 專案對話、Threads、Instagram、Reddit、X、Dcard 與 Facebook 集合在同一個 macOS 應用程式。每個平台與帳號都使用獨立的 Electron session partition，因此 Cookie 與登入狀態不會互相覆蓋。

> 目前支援 macOS，仍在早期開發階段。各社群網站改版後，部分功能可能需要同步調整。

## 主要功能

- 在最左側快速切換 Threads、Instagram、Reddit、X、Dcard、Facebook。
- 「專案對話」直接讀取 Codex 中的對話標題、狀態、摘要與最近更新時間。
- 按「更新對話」即可重新讀取指定 Project 的對話；不推算完成度，也不以上層資料夾命名。
- 每個平台都能新增多個獨立帳號空間。
- Instagram 與 Facebook 提供明確的「登入」與「聊天」快速入口。
- Instagram 與 Facebook 可針對每個帳號開啟「上班模式」，隱藏圖片、影片、Reels 與限時動態入口；關閉後立即恢復完整內容。
- 同平台切換帳號時保留目前頁面；若登入流程跳到其他網站，會回到正確的平台頁面。
- 從 Threads Switcher 升級時沿用既有 Threads 帳號及 session。
- 程式不會讀取或另外儲存密碼。

## 執行

```bash
npm install
npm start
```

## 打包 macOS 應用

```bash
npm run dist:mac
```

輸出會放在 `dist/`。未簽署的本機版本可能需要在 macOS「隱私權與安全性」中允許開啟。

## 使用方式

1. 點選最左側的平台圖示。
2. 第一次使用該平台時，應用程式會自動建立一個帳號空間。
3. 在右側網站完成登入。
4. 如需同平台多帳號，按「新增帳號」建立另一個獨立空間。
5. 使用 Instagram 或 Facebook 時，可在左下角切換「上班模式」，或按「聊天」直接進入訊息頁。

## 專案對話

1. 點選最左側的 `P`。
2. 第一次使用時選擇該 Codex Project 使用的資料夾。
3. 按「更新對話」重新讀取。每張卡片的名稱就是你在 Codex 看到的對話標題。

此功能使用電腦上已登入的 Codex，本機讀取未封存的對話，不會自行估算「完成度」。

## 隱私與安全

- 帳號清單、網站 Cookie 與登入狀態只保存在 macOS 的應用程式資料目錄，不會寫入此專案或上傳到 GitHub。
- 不要將個人的 `accounts.json`、`settings.json`、`.env`、日誌、Cookie 或打包後的使用者資料提交到版本庫。
- 「上班模式」只是本機的視覺隱藏功能，不是隱私防護工具，也無法阻止通知或網站新視窗顯示媒體。

## 授權

本專案採用 [MIT License](LICENSE)。

本專案不是 OpenAI、Meta、Reddit、X 或 Dcard 的官方產品。
