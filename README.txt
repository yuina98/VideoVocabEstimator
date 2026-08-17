Video Vocab Estimator
=====================

A Chrome extension (Manifest V3 + TypeScript) that estimates the vocabulary
size needed to comfortably understand a video, by comparing the video's
subtitles against a word-frequency dictionary. Currently supports YouTube.

It analyzes subtitle text, lemmatizes every word, looks up each lemma in a
graded frequency list, and computes how many word families you would need to
know to cover a given percentage of the running text.

Installation
------------

The extension is built to `dist/`.

1. Run `npm install`.
2. Run `npm run build` to produce the unpacked extension in `dist/`.
3. Open `chrome://extensions`, enable "Developer mode", click
   "Load unpacked", and select the `dist/` directory.

Usage
-----

1. Open any YouTube watch page with subtitles (auto-generated captions work
   too).
2. A "Video Vocab Estimator" panel appears at the top of the sidebar showing
   the recommended vocabulary size, the coverage curve, and the most
   surprising words.
3. Click the extension icon to open the popup, then optionally enter your
   own vocabulary size; it is then marked on the coverage curve on video
   pages.

Development
-----------

```
npm install           # install dependencies
npm run build         # bundle src/ into dist/ (background, content, popup)
npm run watch         # rebuild on every change
npm run typecheck     # run the TypeScript compiler (tsc --noEmit)
npm run measure       # run the analyzer pipeline on a text file
npm run tune          # compare difficulty exponents on a subtitle file
npm run gen:bnc       # generate the BNC/COCA word-family data table
npm run gen:proper-nouns  # generate the proper-nouns list
npm run gen:range-list    # generic classified-word-list generator
```

Tools that take a file argument receive it after `--`:

```
npm run measure -- subtitles.txt     # estimate vocabulary needs of a file
npm run tune -- subtitles.txt        # compare exp=1..3 "surprising words" lists
npm run gen:bnc -- families.xlsx 25  # build bnc.data.ts from the EAP xlsx
npm run gen:proper-nouns -- basewrd31.txt
npm run gen:range-list -- basewrd.txt src/dictionary/out.ts EXPORT_NAME "header"
```

Data sources
------------

- BNC/COCA 25k word families (v2), EAP Foundation.
- Official BNC/COCA classified word lists (proper names, marginal words,
  acronyms) from the Range program:
  https://www.wgtn.ac.nz/lals/resources/paul-nations-resources/vocabulary-analysis-programs

AI disclosure
--------------

This project is developed with the assistance of artificial intelligence.
The following LLMs were used during the development process:

- deepseek-v4-flash-0731

License
-------

BSD 3-Clause License. See the LICENSE file for details.
