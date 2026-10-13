/**
 * Styles that only exist while editing: hints in empty fields, the selected block, the gap cursor. None of it reaches
 * the export. Nothing here changes size or spacing, so the page measures the same with and without it.
 */
export const EDITOR_CSS = `
.rs-editor{outline:none;cursor:text;caret-color:#111}
.rs-editor .is-empty::before{content:attr(data-placeholder);color:rgba(17,17,17,.34);pointer-events:none;float:left;height:0;font-weight:400;font-style:normal;letter-spacing:normal;text-transform:none;white-space:nowrap}
.rs-editor .rs-role-dates.is-empty::before,.rs-editor .rs-edu-dates.is-empty::before{float:right}
.rs-editor .rs-project-detail.is-empty,.rs-editor .rs-role-company.is-empty,.rs-editor .rs-role-location.is-empty{margin-left:.5em}
.rs-editor .rs-name.is-empty::before,.rs-editor .rs-headline.is-empty::before,.rs-editor .rs-contact.is-empty::before{float:none;display:block;text-align:center;height:auto}
.rs-editor ::selection{background:rgba(59,130,246,.28)}
.rs-editor .ProseMirror-selectednode{outline:2px solid rgba(59,130,246,.55);outline-offset:3px;border-radius:3px}
.rs-editor .ProseMirror-gapcursor{display:none;pointer-events:none;position:absolute}
.rs-editor .ProseMirror-gapcursor::after{content:"";display:block;position:absolute;top:-2px;width:20px;border-top:1px solid #111;animation:rs-blink 1.1s steps(2,start) infinite}
@keyframes rs-blink{to{visibility:hidden}}
.rs-editor.ProseMirror-focused .ProseMirror-gapcursor{display:block}
@media (prefers-reduced-motion:reduce){.rs-editor .ProseMirror-gapcursor::after{animation:none}}
`;
