export const swaggerCustomStyles = `
  /* ============================================================
     AmbiaPay Swagger theme - dark / green
     ============================================================ */
  :root {
    --bg: #1b1f23;
    --surface: #22272b;
    --panel: #14291f;
    --panel-head: #1a3b2f;
    --border: #2d4a3e;
    --border-soft: #2f353a;
    --text: #e6edf3;
    --text-muted: #9aa7b0;
    --code-bg: #0b1016;
    --green: #10b981;
    --green-dark: #059669;
    --blue: #5b9cf5;
    --blue-dark: #3b82f6;
    --orange: #f59e0b;
    --red: #f93e3e;
    --purple: #8b5cf6;
    --mono: 'Monaco', 'Menlo', 'Ubuntu Mono', 'Consolas', monospace;
  }

  html, body {
    background-color: var(--bg) !important;
    color: var(--text);
  }

  .swagger-ui,
  .swagger-ui .wrapper {
    background-color: var(--bg);
    color: var(--text);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  }

  .swagger-ui .topbar { display: none; }

  /* ---------- Generic text ---------- */
  .swagger-ui,
  .swagger-ui p,
  .swagger-ui li,
  .swagger-ui label,
  .swagger-ui td,
  .swagger-ui th,
  .swagger-ui h1, .swagger-ui h2, .swagger-ui h3,
  .swagger-ui h4, .swagger-ui h5, .swagger-ui h6,
  .swagger-ui .tab li,
  .swagger-ui .opblock-tag,
  .swagger-ui .opblock .opblock-section-header h4,
  .swagger-ui .opblock .opblock-section-header label,
  .swagger-ui .parameter__name,
  .swagger-ui .parameter__type,
  .swagger-ui .response-col_status,
  .swagger-ui .response-col_description,
  .swagger-ui .responses-inner h4,
  .swagger-ui .responses-inner h5,
  .swagger-ui .model-title,
  .swagger-ui .model,
  .swagger-ui .prop-type,
  .swagger-ui .info .title,
  .swagger-ui .info li,
  .swagger-ui .info p,
  .swagger-ui .info table,
  .swagger-ui .scheme-container .schemes > label,
  .swagger-ui .servers > label,
  .swagger-ui section.models h4,
  .swagger-ui .dialog-ux .modal-ux-header h3,
  .swagger-ui .dialog-ux .modal-ux-content p,
  .swagger-ui .dialog-ux .modal-ux-content h4,
  .swagger-ui .dialog-ux .modal-ux-content label {
    color: var(--text);
  }

  .swagger-ui .parameter__type,
  .swagger-ui .parameter__in,
  .swagger-ui .opblock-summary-description,
  .swagger-ui .opblock-description-wrapper p,
  .swagger-ui .parameters-col_description p,
  .swagger-ui .response-col_description__inner p,
  .swagger-ui .prop-format,
  .swagger-ui table.model tr.description {
    color: var(--text-muted);
  }

  .swagger-ui a { color: var(--blue); text-decoration: none; }
  .swagger-ui a:hover { color: #8ab9ff; text-decoration: underline; }

  /* ---------- Info / header ---------- */
  .swagger-ui .information-container {
    background: var(--surface);
    padding: 30px;
    border-radius: 8px;
    margin-bottom: 20px;
    border: 1px solid var(--border-soft);
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.35);
  }

  .swagger-ui .info { margin: 30px 0; }

  .swagger-ui .info .title {
    font-size: 36px;
    font-weight: 700;
    margin-bottom: 10px;
  }

  .swagger-ui .info .title small {
    background: var(--green);
    color: #fff;
    padding: 4px 12px;
    border-radius: 20px;
    font-size: 14px;
    font-weight: 600;
    margin-left: 12px;
    vertical-align: middle;
  }

  .swagger-ui .info .title small pre { color: #fff; }

  .swagger-ui .info .description,
  .swagger-ui .info .description .markdown {
    color: var(--text-muted);
    font-size: 15px;
    line-height: 1.7;
  }

  /* ---------- Scheme / server container ---------- */
  .swagger-ui .scheme-container {
    background: var(--surface);
    border: 1px solid var(--border-soft);
    border-radius: 8px;
    padding: 20px;
    margin: 20px 0;
    box-shadow: none;
  }

  /* ---------- Tags ---------- */
  .swagger-ui .opblock-tag {
    font-size: 20px;
    font-weight: 600;
    border-bottom: 2px solid var(--border);
    padding: 15px 0;
    margin: 30px 0 15px 0;
  }

  .swagger-ui .opblock-tag small { color: var(--text-muted); }
  .swagger-ui .opblock-tag:hover { background: rgba(16, 185, 129, 0.06); }

  /* ---------- Operation blocks ---------- */
  .swagger-ui .opblock {
    border: 1px solid var(--border);
    border-radius: 8px;
    margin: 0 0 15px 0;
    background: var(--panel);
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.35);
  }

  .swagger-ui .opblock .opblock-section-header {
    background: var(--panel-head);
    box-shadow: none;
    border-bottom: 1px solid var(--border);
  }

  .swagger-ui .opblock .opblock-section-header h4 { color: var(--text); }

  .swagger-ui .opblock-body,
  .swagger-ui .opblock-description-wrapper,
  .swagger-ui .opblock-external-docs-wrapper,
  .swagger-ui .opblock-title_normal {
    color: var(--text);
  }

  .swagger-ui .opblock.opblock-get    { border-color: var(--blue-dark); background: rgba(59, 130, 246, 0.08); }
  .swagger-ui .opblock.opblock-post   { border-color: var(--green);     background: #14291f; }
  .swagger-ui .opblock.opblock-put    { border-color: var(--orange);    background: rgba(245, 158, 11, 0.08); }
  .swagger-ui .opblock.opblock-patch  { border-color: #14b8a6;          background: rgba(20, 184, 166, 0.08); }
  .swagger-ui .opblock.opblock-delete { border-color: #ef4444;          background: rgba(239, 68, 68, 0.08); }

  .swagger-ui .opblock.opblock-get .opblock-summary-method    { background: var(--blue-dark); }
  .swagger-ui .opblock.opblock-post .opblock-summary-method   { background: var(--green); }
  .swagger-ui .opblock.opblock-put .opblock-summary-method    { background: var(--orange); }
  .swagger-ui .opblock.opblock-patch .opblock-summary-method  { background: #14b8a6; }
  .swagger-ui .opblock.opblock-delete .opblock-summary-method { background: #ef4444; }

  .swagger-ui .opblock.opblock-get .opblock-summary    { border-color: var(--blue-dark); }
  .swagger-ui .opblock.opblock-post .opblock-summary   { border-color: var(--green); }
  .swagger-ui .opblock.opblock-put .opblock-summary    { border-color: var(--orange); }
  .swagger-ui .opblock.opblock-patch .opblock-summary  { border-color: #14b8a6; }
  .swagger-ui .opblock.opblock-delete .opblock-summary { border-color: #ef4444; }

  .swagger-ui .opblock-summary { padding: 12px 20px; cursor: pointer; }

  .swagger-ui .opblock-summary-method {
    border-radius: 6px;
    font-weight: 700;
    min-width: 80px;
    text-align: center;
    font-size: 13px;
    color: #fff;
  }

  .swagger-ui .opblock-summary-path,
  .swagger-ui .opblock-summary-path__deprecated {
    font-family: var(--mono);
    font-size: 14px;
    color: var(--text);
    font-weight: 600;
  }

  .swagger-ui .opblock-summary-description { font-size: 14px; }

  /* Arrow / icon colours */
  .swagger-ui svg:not(:root),
  .swagger-ui .opblock-summary-control svg,
  .swagger-ui .expand-methods svg,
  .swagger-ui .expand-operation svg,
  .swagger-ui .model-toggle,
  .swagger-ui .authorization__btn svg {
    fill: var(--text);
  }

  /* ---------- Buttons ---------- */
  .swagger-ui .btn {
    border-radius: 6px;
    font-weight: 600;
    font-size: 14px;
    padding: 8px 16px;
    color: var(--text);
    background: transparent;
    border: 2px solid var(--border);
    box-shadow: none;
  }

  .swagger-ui .btn:hover { box-shadow: none; }

  .swagger-ui .btn.execute {
    background: var(--blue);
    border-color: var(--blue);
    color: #0b1016;
  }
  .swagger-ui .btn.execute:hover { background: #7bb0f8; border-color: #7bb0f8; }

  .swagger-ui .btn.btn-clear {
    background: transparent;
    border-color: var(--text);
    color: var(--text);
  }

  .swagger-ui .btn.try-out__btn {
    background: transparent;
    border-color: var(--text-muted);
    color: var(--text);
  }
  .swagger-ui .btn.try-out__btn:hover { background: rgba(255, 255, 255, 0.08); }

  .swagger-ui .btn.try-out__btn.cancel,
  .swagger-ui .btn.cancel {
    background: transparent;
    border-color: var(--red);
    color: var(--red);
  }

  .swagger-ui .btn.authorize {
    background: transparent;
    border-color: var(--green);
    color: var(--green);
  }
  .swagger-ui .btn.authorize svg { fill: var(--green); }
  .swagger-ui .btn.authorize:hover { background: rgba(16, 185, 129, 0.12); }

  /* ---------- Parameters / responses ---------- */
  .swagger-ui .parameters-col_description { font-size: 14px; }
  .swagger-ui .parameter__name { font-weight: 600; }
  .swagger-ui .parameter__name.required span,
  .swagger-ui .parameter__name.required::after { color: var(--red); }
  .swagger-ui .parameter__type { font-size: 12px; }

  .swagger-ui .opblock-description-wrapper,
  .swagger-ui .opblock-external-docs-wrapper,
  .swagger-ui .opblock-title_normal { font-size: 14px; }

  .swagger-ui .response-col_status { font-weight: 700; font-size: 14px; }
  .swagger-ui .response-col_links { color: var(--text-muted); }

  .swagger-ui .responses-inner h4,
  .swagger-ui .responses-inner h5 {
    font-size: 14px;
    font-weight: 600;
    margin: 20px 0 10px 0;
  }

  .swagger-ui .responses-wrapper { margin-top: 24px; }
  .swagger-ui .responses-wrapper .responses-inner {
    padding-top: 16px;
    border-top: 2px solid var(--border);
  }

  .swagger-ui .live-responses-table { margin-top: 20px; }

  .swagger-ui .tab li { color: var(--text-muted); }
  .swagger-ui .tab li.active { color: var(--text); }

  /* ---------- Tables ---------- */
  .swagger-ui table { border-collapse: collapse; }

  .swagger-ui table thead tr th,
  .swagger-ui table thead tr td {
    background: transparent;
    color: var(--text);
    font-weight: 600;
    font-size: 13px;
    padding: 12px;
    border-bottom: 2px solid var(--border);
  }

  .swagger-ui table tbody tr td {
    padding: 12px;
    border-bottom: 1px solid var(--border);
    color: var(--text-muted);
    font-size: 14px;
  }

  /* ---------- Inputs ---------- */
  .swagger-ui input[type=text],
  .swagger-ui input[type=password],
  .swagger-ui input[type=search],
  .swagger-ui input[type=email],
  .swagger-ui input[type=file],
  .swagger-ui textarea,
  .swagger-ui select {
    background: var(--code-bg);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 8px 12px;
    font-size: 14px;
  }

  .swagger-ui select {
    background: var(--code-bg);
    color: var(--text);
    border: 2px solid var(--text);
    font-weight: 600;
  }

  .swagger-ui input[type=text]:focus,
  .swagger-ui input[type=password]:focus,
  .swagger-ui textarea:focus,
  .swagger-ui select:focus {
    border-color: var(--green);
    outline: none;
    box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.2);
  }

  .swagger-ui textarea.body-param__text,
  .swagger-ui .body-param__text {
    background: var(--code-bg);
    color: var(--text);
    font-family: var(--mono);
    font-size: 13px;
    min-height: 220px;
  }

  /* ---------- Code blocks (request + response) ---------- */
  .swagger-ui .highlight-code,
  .swagger-ui .curl-command,
  .swagger-ui .request-url {
    background: var(--code-bg);
    border-radius: 6px;
  }

  .swagger-ui .highlight-code { position: relative; }

  .swagger-ui pre.microlight,
  .swagger-ui .highlight-code .microlight,
  .swagger-ui .highlight-code > pre,
  .swagger-ui .request-url pre {
    background: var(--code-bg) !important;
    color: #e5e7eb !important;
    font-family: var(--mono);
    font-size: 13px;
    line-height: 1.6;
    padding: 16px;
    border-radius: 6px;
  }

  .swagger-ui .request-url { padding: 0; margin: 16px 0; }
  .swagger-ui .request-url pre { margin: 0; font-weight: 500; }

  /* Long values (JWT tokens etc.) wrap, stay fully visible and are selectable */
  .swagger-ui .highlight-code,
  .swagger-ui .highlight-code > .microlight,
  .swagger-ui .responses-table .microlight,
  .swagger-ui .live-responses-table .microlight,
  .swagger-ui .curl-command .microlight {
    max-height: none !important;
    overflow: visible !important;
    white-space: pre-wrap !important;
    word-break: break-all !important;
    overflow-wrap: anywhere !important;
    user-select: text !important;
    -webkit-user-select: text !important;
  }

  /* Keep the copy button from covering response text */
  .swagger-ui .highlight-code .microlight { padding-top: 44px; }
  .swagger-ui .highlight-code .copy-to-clipboard {
    position: absolute;
    top: 8px;
    right: 8px;
    z-index: 5;
    width: 28px;
    height: 28px;
    background: #374151;
    border-radius: 4px;
  }
  .swagger-ui .highlight-code .copy-to-clipboard:hover { background: #4b5563; }

  .swagger-ui .request-snippet .snippet__title,
  .swagger-ui .curl-command h4 { color: var(--text-muted); }

  /* ---------- Models ---------- */
  .swagger-ui section.models {
    border: 1px solid var(--border);
    background: var(--surface);
    border-radius: 8px;
  }
  .swagger-ui section.models.is-open h4 { border-bottom: 1px solid var(--border); }
  .swagger-ui section.models .model-container {
    background: var(--panel);
    border-radius: 6px;
  }
  .swagger-ui .model-box {
    background: var(--panel);
    border-radius: 6px;
    padding: 16px;
  }
  .swagger-ui .model-title { font-weight: 600; }
  .swagger-ui .model { font-family: var(--mono); font-size: 13px; }
  .swagger-ui .model .property.primitive { color: var(--text-muted); }

  /* ---------- Authorization modal ---------- */
  .swagger-ui .dialog-ux .backdrop-ux { background: rgba(0, 0, 0, 0.7); }

  .swagger-ui .dialog-ux .modal-ux {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.6);
  }

  .swagger-ui .dialog-ux .modal-ux-header {
    background: var(--panel-head);
    border-bottom: 2px solid var(--border);
    padding: 20px;
  }

  .swagger-ui .dialog-ux .modal-ux-header h3 { font-weight: 600; }
  .swagger-ui .dialog-ux .modal-ux-content { padding: 20px; }
  .swagger-ui .dialog-ux .modal-ux-header .close-modal svg { fill: var(--text); }

  .swagger-ui .auth-container {
    border-bottom: 1px solid var(--border);
  }

  /* ---------- Markdown ---------- */
  .swagger-ui .markdown p,
  .swagger-ui .renderedMarkdown p {
    margin: 0 0 12px 0;
    line-height: 1.7;
  }

  .swagger-ui .markdown code,
  .swagger-ui .renderedMarkdown code {
    background: #2a3136;
    color: #ff8a8a;
    padding: 2px 6px;
    border-radius: 4px;
    font-size: 0.9em;
    font-family: var(--mono);
  }

  .swagger-ui .markdown pre,
  .swagger-ui .renderedMarkdown pre {
    background: var(--code-bg);
    padding: 16px;
    border-radius: 6px;
    overflow-x: auto;
  }

  .swagger-ui .markdown pre code,
  .swagger-ui .renderedMarkdown pre code {
    background: transparent;
    color: #e5e7eb;
    padding: 0;
  }

  .swagger-ui .markdown h1 {
    font-size: 28px;
    font-weight: 700;
    color: var(--text);
    margin: 30px 0 15px 0;
    border-bottom: 2px solid var(--border);
    padding-bottom: 10px;
  }

  .swagger-ui .markdown h2 {
    font-size: 22px;
    font-weight: 600;
    color: var(--text);
    margin: 25px 0 12px 0;
  }

  .swagger-ui .markdown h3 {
    font-size: 18px;
    font-weight: 600;
    color: #d1d9e0;
    margin: 20px 0 10px 0;
  }

  .swagger-ui .markdown ul,
  .swagger-ui .markdown ol {
    margin: 0 0 12px 20px;
    padding-left: 20px;
  }

  .swagger-ui .markdown li { margin: 6px 0; line-height: 1.6; }

  .swagger-ui .markdown hr {
    border: none;
    border-top: 2px solid var(--border);
    margin: 30px 0;
  }

  .swagger-ui .markdown strong { color: var(--text); }

  /* ---------- Scrollbars ---------- */
  * { scrollbar-width: thin; scrollbar-color: #3a4a44 var(--bg); }

  /* ============================================================
     Test variables panel (bottom-right, from swagger-script.ts)
     ============================================================ */
  .swg-vars {
    position: fixed;
    bottom: 16px;
    right: 16px;
    z-index: 9999;
    width: 240px;
    background: var(--surface);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 12px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
    font: 13px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  }
  .swg-vars b { color: var(--green); }
  .swg-vars label { display: block; margin-top: 8px; color: var(--text-muted); }
  .swg-vars input {
    width: 100%;
    box-sizing: border-box;
    margin-top: 4px;
    background: var(--code-bg);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 6px 8px;
  }

  /* ============================================================
     API Information footer (bottom of the whole page)
     ============================================================ */
  .api-footer {
    max-width: 1460px;
    margin: 40px auto 0;
    padding: 0 20px 40px;
    color: var(--text);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  }

  .api-footer-card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-top: 3px solid var(--green);
    border-radius: 8px;
    padding: 24px 30px;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.35);
  }

  .api-footer h2 {
    margin: 0 0 16px 0;
    font-size: 22px;
    font-weight: 600;
    color: var(--text);
  }

  .api-footer-row {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 10px;
    margin: 6px 0;
    font-size: 15px;
    color: var(--text-muted);
  }

  .api-footer-row .label { font-weight: 700; color: var(--text); min-width: 140px; }
  .api-footer-row .value { color: var(--text-muted); }
  .api-footer-row a { color: var(--blue); text-decoration: none; }
  .api-footer-row a:hover { text-decoration: underline; }

  .api-footer-copy {
    margin-top: 18px;
    padding-top: 14px;
    border-top: 1px solid var(--border);
    font-size: 13px;
    color: var(--text-muted);
  }

  @media (max-width: 640px) {
    .api-footer-row .label { min-width: 100%; }
    .swg-vars { width: 200px; }
  }
`;