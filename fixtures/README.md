# Fixtures

M0 用的測試資料，對應 `plan.md` §3.2：

```
C302-2025F/
  class.json                 3 位學生（S07／S08／S12）
  E20250107/
    assignment.json          國中預設量規
    S07/work.json            已批完（含 D25 詞句改寫、錯字）
    S08/work.json            批閱中（含語序批注）
    S12/work.json            待批
    S07|S08|S12/p1.jpg p2.jpg
```

頁面圖由 `tools/make_fixture_pages.ps1` 產生：1200×1600、白底、橫線、左側紅邊。
重跑會覆蓋既有圖片，`work.json` 不會被動到。
