# Fonts

Cut-down copies of two typefaces, so the page looks the same on a machine that has neither installed. dotjar loads nothing from the network.

| File | Typeface | Licence | What is in it |
|---|---|---|---|
| `huiwen-mincho-titles.woff` | 汇文明朝体 (Huiwen-mincho) 1.00 | Public domain, as its copyright field states | Only the characters of the interface's own Chinese titles (`huiwen-mincho-titles.txt`) |
| `lxgw-wenkai-regular.woff`, `lxgw-wenkai-medium.woff` | [霞鹜文楷 (LXGW WenKai)](https://github.com/lxgw/LxgwWenKai) 1.522 | [SIL Open Font License 1.1](https://openfontlicense.org) | GB2312, Latin and the usual punctuation (`lxgw-wenkai.txt`) |

Copyright 2021-2026 LXGW; Copyright 2020 The Klee Project Authors. The copyright and licence notices are kept inside the font files.

汇文明朝体 draws some simplified characters in an old form that reads as another character (让 looks like 註), so it is only used for text that is known in advance, and those characters are left out of the cut.

To cut them again, after changing a title in `words.js` or to take a newer release:

```bash
node scripts/fonts.js ~/Library/Fonts
```

That needs `pyftsubset` (from Python's fonttools) and the original font files in the folder given.
