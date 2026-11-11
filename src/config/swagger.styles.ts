export const swaggerCustomStyles = `
  /* ============================================================
     AmbiaPay Swagger UI — Modern Developer Experience Theme
     ============================================================ */

  /* Hide default topbar */
  .swagger-ui .topbar { display: none !important; }

  /* Smooth scrolling and base typography */
  html {
    scroll-behavior: smooth;
  }

  body {
    background-color: #f8fafc;
    color: #0f172a;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
    margin: 0;
    padding: 0;
  }

  .swagger-ui {
    background-color: #f8fafc;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    color: #0f172a;
  }

  /* Main container wrapper (only top-level) */
  .swagger-ui > .wrapper,
  .swagger-ui > div > .wrapper {
    max-width: 1440px;
    margin: 0 auto;
    padding: 24px 20px;
    box-sizing: border-box;
    background-color: transparent;
  }

  /* ============================================================
     1. Information Container (Header Card)
     ============================================================ */
  .swagger-ui .information-container {
    background: #ffffff;
    padding: 36px 40px;
    border-radius: 16px;
    margin-bottom: 24px;
    border: 1px solid #e2e8f0;
    box-shadow: 0 4px 20px -2px rgba(15, 23, 42, 0.05), 0 2px 6px -1px rgba(15, 23, 42, 0.02);
    position: relative;
    overflow: hidden;
  }

  .swagger-ui .information-container::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 4px;
    background: linear-gradient(90deg, #10b981 0%, #3b82f6 50%, #6366f1 100%);
  }

  .swagger-ui .info {
    margin: 10px 0 0 0;
  }

  .swagger-ui .info .title {
    font-size: 34px;
    color: #0f172a;
    font-weight: 800;
    letter-spacing: -0.025em;
    margin-bottom: 12px;
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 12px;
  }

  .swagger-ui .info .title small {
    background: linear-gradient(135deg, #10b981, #059669);
    color: #ffffff;
    padding: 4px 14px;
    border-radius: 9999px;
    font-size: 13px;
    font-weight: 700;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    box-shadow: 0 2px 8px rgba(16, 185, 129, 0.3);
    vertical-align: middle;
    top: 0;
  }

  .swagger-ui .info .description {
    color: #334155;
    font-size: 15px;
    line-height: 1.75;
  }

  /* Markdown content inside info */
  .swagger-ui .markdown h1 {
    font-size: 26px;
    font-weight: 700;
    color: #0f172a;
    margin: 28px 0 16px 0;
    border-bottom: 1px solid #e2e8f0;
    padding-bottom: 10px;
    letter-spacing: -0.02em;
  }

  .swagger-ui .markdown h2 {
    font-size: 20px;
    font-weight: 700;
    color: #1e293b;
    margin: 28px 0 12px 0;
    letter-spacing: -0.015em;
  }

  .swagger-ui .markdown h3 {
    font-size: 16px;
    font-weight: 600;
    color: #334155;
    margin: 20px 0 8px 0;
  }

  .swagger-ui .markdown p {
    margin: 0 0 14px 0;
    line-height: 1.7;
    color: #334155;
  }

  .swagger-ui .markdown ul, .swagger-ui .markdown ol {
    margin: 0 0 16px 0;
    padding-left: 24px;
  }

  .swagger-ui .markdown li {
    margin: 6px 0;
    line-height: 1.65;
    color: #334155;
  }

  .swagger-ui .markdown hr {
    border: none;
    border-top: 1px solid #e2e8f0;
    margin: 28px 0;
  }

  .swagger-ui .markdown code {
    background: #f1f5f9;
    color: #0f172a;
    padding: 3px 7px;
    border-radius: 6px;
    font-size: 0.88em;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    border: 1px solid #e2e8f0;
  }

  .swagger-ui .markdown pre {
    background: #0f172a;
    border-radius: 10px;
    padding: 18px 20px;
    overflow-x: auto;
    border: 1px solid #1e293b;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
  }

  .swagger-ui .markdown pre code {
    background: transparent;
    color: #e2e8f0;
    padding: 0;
    border: none;
    font-size: 13.5px;
    line-height: 1.6;
  }

  /* ============================================================
     2. Scheme / Server / Authorize Top Toolbar
     ============================================================ */
  .swagger-ui .scheme-container {
    background: #ffffff;
    border: 1px solid #e2e8f0;
    border-radius: 14px;
    padding: 16px 24px;
    margin: 20px 0 28px 0;
    box-shadow: 0 2px 10px -2px rgba(15, 23, 42, 0.04);
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 16px;
  }

  .swagger-ui .schemes {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
  }

  .swagger-ui .schemes > label {
    font-weight: 600;
    color: #475569;
    font-size: 13.5px;
    margin: 0;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .swagger-ui select {
    appearance: none;
    background: #ffffff url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3E%3Cpath stroke='%2364748b' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3E%3C/svg%3E") no-repeat right 12px center/16px 16px;
    border: 1.5px solid #cbd5e1;
    border-radius: 10px;
    padding: 9px 38px 9px 14px;
    font-size: 14px;
    font-weight: 500;
    color: #0f172a;
    outline: none;
    transition: all 0.2s ease;
    cursor: pointer;
  }

  .swagger-ui select:hover {
    border-color: #94a3b8;
  }

  .swagger-ui select:focus {
    border-color: #3b82f6;
    box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.15);
  }

  /* Authorize Button in Toolbar */
  .swagger-ui .btn.authorize {
    background: linear-gradient(135deg, #4f46e5 0%, #6366f1 100%);
    border: none;
    color: #ffffff;
    border-radius: 10px;
    font-size: 14px;
    font-weight: 600;
    padding: 10px 22px;
    box-shadow: 0 4px 12px rgba(79, 70, 229, 0.25);
    transition: all 0.2s ease;
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }

  .swagger-ui .btn.authorize:hover {
    transform: translateY(-1px);
    box-shadow: 0 6px 18px rgba(79, 70, 229, 0.35);
    background: linear-gradient(135deg, #4338ca 0%, #4f46e5 100%);
  }

  .swagger-ui .btn.authorize svg {
    fill: #ffffff;
    width: 16px;
    height: 16px;
  }

  .swagger-ui .btn.authorize.locked {
    background: linear-gradient(135deg, #059669 0%, #10b981 100%);
    box-shadow: 0 4px 12px rgba(16, 185, 129, 0.25);
  }

  .swagger-ui .btn.authorize.locked:hover {
    background: linear-gradient(135deg, #047857 0%, #059669 100%);
  }

  /* ============================================================
     3. Modern Available Authorizations Modal Design
     ============================================================ */

  /* Dialog full-screen wrapper: centers the modal dialog */
  .swagger-ui .dialog-ux {
    position: fixed !important;
    top: 0 !important;
    left: 0 !important;
    right: 0 !important;
    bottom: 0 !important;
    width: 100vw !important;
    height: 100vh !important;
    z-index: 99999 !important;
    display: flex !important;
    align-items: center !important;
    justify-content: center !important;
    padding: 24px !important;
    box-sizing: border-box !important;
    background: transparent !important;
    transform: none !important;
    border: none !important;
    box-shadow: none !important;
    max-width: none !important;
    border-radius: 0 !important;
    overflow: auto !important;
  }

  /* Backdrop overlay: stays behind the modal */
  .swagger-ui .dialog-ux .backdrop-ux {
    position: fixed !important;
    top: 0 !important;
    left: 0 !important;
    right: 0 !important;
    bottom: 0 !important;
    width: 100vw !important;
    height: 100vh !important;
    background: rgba(15, 23, 42, 0.65) !important;
    backdrop-filter: blur(4px) !important;
    -webkit-backdrop-filter: blur(4px) !important;
    z-index: 1 !important;
    cursor: pointer !important;
  }

  /* The actual modal window card: sits above backdrop */
  .swagger-ui .dialog-ux .modal-ux {
    position: relative !important;
    z-index: 10 !important;
    top: auto !important;
    left: auto !important;
    right: auto !important;
    bottom: auto !important;
    transform: none !important;
    margin: auto !important;
    width: 100% !important;
    max-width: 680px !important;
    max-height: 88vh !important;
    background: #ffffff !important;
    border-radius: 16px !important;
    border: 1px solid #cbd5e1 !important;
    box-shadow: 0 25px 50px -12px rgba(15, 23, 42, 0.4), 0 0 0 1px rgba(0, 0, 0, 0.08) !important;
    overflow: hidden !important;
    display: flex !important;
    flex-direction: column !important;
    box-sizing: border-box !important;
    opacity: 1 !important;
    visibility: visible !important;
  }

  /* Unset general wrapper padding inside modal */
  .swagger-ui .modal-ux .wrapper {
    max-width: none !important;
    margin: 0 !important;
    padding: 0 !important;
    background: transparent !important;
  }

  /* Modal Header */
  .swagger-ui .modal-ux-header {
    background: #ffffff !important;
    border-bottom: 1px solid #e2e8f0 !important;
    padding: 20px 24px !important;
    display: flex !important;
    align-items: center !important;
    justify-content: space-between !important;
    flex-shrink: 0 !important;
  }

  .swagger-ui .modal-ux-header h3 {
    font-size: 19px !important;
    font-weight: 700 !important;
    color: #0f172a !important;
    letter-spacing: -0.015em !important;
    margin: 0 !important;
    display: flex !important;
    align-items: center !important;
    gap: 8px !important;
  }

  .swagger-ui .modal-ux-header .close-modal {
    position: relative !important;
    top: auto !important;
    right: auto !important;
    background: #f1f5f9 !important;
    border: 1px solid #e2e8f0 !important;
    border-radius: 8px !important;
    width: 32px !important;
    height: 32px !important;
    display: flex !important;
    align-items: center !important;
    justify-content: center !important;
    cursor: pointer !important;
    color: #64748b !important;
    padding: 0 !important;
    transition: all 0.2s ease !important;
  }

  .swagger-ui .modal-ux-header .close-modal:hover {
    background: #e2e8f0 !important;
    color: #0f172a !important;
    transform: scale(1.05) !important;
  }

  .swagger-ui .modal-ux-header .close-modal svg {
    width: 14px !important;
    height: 14px !important;
    fill: currentColor !important;
  }

  /* Modal Content Body */
  .swagger-ui .modal-ux-content {
    padding: 20px 24px 24px !important;
    max-height: calc(88vh - 80px) !important;
    overflow-y: auto !important;
    background: #f8fafc !important;
    color: #0f172a !important;
    flex: 1 1 auto !important;
  }

  .swagger-ui .modal-ux-content p {
    color: #64748b !important;
    font-size: 14px !important;
    line-height: 1.6 !important;
    margin: 0 0 16px 0 !important;
  }

  /* Each Authorization Scheme Card */
  .swagger-ui .auth-container {
    background: #ffffff !important;
    border: 1.5px solid #e2e8f0 !important;
    border-radius: 12px !important;
    padding: 20px !important;
    margin-bottom: 16px !important;
    box-shadow: 0 2px 6px rgba(15, 23, 42, 0.03) !important;
    transition: all 0.2s ease !important;
  }

  .swagger-ui .auth-container:hover {
    border-color: #cbd5e1 !important;
    box-shadow: 0 4px 12px -2px rgba(15, 23, 42, 0.06) !important;
  }

  .swagger-ui .auth-container h4 {
    font-size: 16px !important;
    font-weight: 700 !important;
    color: #0f172a !important;
    margin: 0 0 8px 0 !important;
    display: flex !important;
    align-items: center !important;
    gap: 8px !important;
  }

  .swagger-ui .auth-container h4 code {
    background: #f1f5f9 !important;
    color: #475569 !important;
    border: 1px solid #e2e8f0 !important;
    border-radius: 6px !important;
    font-size: 12px !important;
    padding: 2px 8px !important;
    font-family: ui-monospace, SFMono-Regular, monospace !important;
  }

  .swagger-ui .auth-container label {
    font-size: 13px !important;
    font-weight: 600 !important;
    color: #334155 !important;
    margin: 10px 0 6px 0 !important;
    display: block !important;
  }

  /* Modal Form Inputs */
  .swagger-ui .modal-ux input[type=text],
  .swagger-ui .modal-ux input[type=password] {
    display: block !important;
    width: 100% !important;
    max-width: 100% !important;
    box-sizing: border-box !important;
    background: #ffffff !important;
    border: 1.5px solid #cbd5e1 !important;
    border-radius: 8px !important;
    padding: 10px 12px !important;
    font-size: 14px !important;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace !important;
    color: #0f172a !important;
    transition: all 0.2s ease !important;
    outline: none !important;
    margin: 6px 0 12px 0 !important;
  }

  .swagger-ui .modal-ux input[type=text]:focus,
  .swagger-ui .modal-ux input[type=password]:focus {
    border-color: #3b82f6 !important;
    box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.2) !important;
  }

  /* Scopes section in modal */
  .swagger-ui .modal-ux .scopes h2 {
    font-size: 14px !important;
    font-weight: 700 !important;
    color: #334155 !important;
    margin: 16px 0 8px !important;
  }

  .swagger-ui .modal-ux .scope-def {
    font-size: 13px !important;
    color: #64748b !important;
    margin-bottom: 6px !important;
  }

  /* Auth Actions inside Scheme */
  .swagger-ui .auth-btn-wrapper {
    display: flex !important;
    align-items: center !important;
    justify-content: flex-end !important;
    gap: 10px !important;
    margin-top: 16px !important;
    padding-top: 12px !important;
    border-top: 1px solid #f1f5f9 !important;
  }

  .swagger-ui .modal-btn.auth {
    background: linear-gradient(135deg, #2563eb, #1d4ed8) !important;
    color: #ffffff !important;
    border: none !important;
    border-radius: 8px !important;
    font-size: 13.5px !important;
    font-weight: 600 !important;
    padding: 9px 20px !important;
    cursor: pointer !important;
    box-shadow: 0 2px 6px rgba(37, 99, 235, 0.25) !important;
    transition: all 0.2s ease !important;
  }

  .swagger-ui .modal-btn.auth:hover {
    background: linear-gradient(135deg, #1d4ed8, #1e40af) !important;
    transform: translateY(-1px) !important;
    box-shadow: 0 4px 10px rgba(37, 99, 235, 0.35) !important;
  }

  .swagger-ui .modal-btn.auth.button:not(.authorize) {
    background: #fee2e2 !important;
    color: #b91c1c !important;
    border: 1px solid #fca5a5 !important;
    box-shadow: none !important;
  }

  .swagger-ui .modal-btn.auth.button:not(.authorize):hover {
    background: #fecaca !important;
    color: #991b1b !important;
  }

  /* Modal Close/Done Footer Button */
  .swagger-ui .modal-ux-content > .btn-done {
    background: #0f172a !important;
    color: #ffffff !important;
    border: none !important;
    border-radius: 8px !important;
    font-size: 14px !important;
    font-weight: 600 !important;
    padding: 10px 28px !important;
    cursor: pointer !important;
    float: right !important;
    margin-top: 14px !important;
    box-shadow: 0 4px 12px rgba(15, 23, 42, 0.15) !important;
    transition: all 0.2s ease !important;
  }

  .swagger-ui .modal-ux-content > .btn-done:hover {
    background: #1e293b !important;
    transform: translateY(-1px) !important;
    box-shadow: 0 6px 16px rgba(15, 23, 42, 0.25) !important;
  }

  /* ============================================================
     4. Tag Sections and Grouping
     ============================================================ */
  .swagger-ui .opblock-tag-section {
    margin-bottom: 24px;
  }

  .swagger-ui .opblock-tag {
    font-size: 21px;
    font-weight: 700;
    color: #0f172a;
    border-bottom: 2px solid #e2e8f0;
    padding: 16px 0 14px 0;
    margin: 36px 0 18px 0;
    letter-spacing: -0.015em;
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .swagger-ui .opblock-tag small {
    font-size: 14px;
    font-weight: 500;
    color: #64748b;
    padding-left: 6px;
  }

  .swagger-ui .opblock-tag svg {
    fill: #64748b;
    transition: transform 0.2s ease;
  }

  /* ============================================================
     5. Modern Operation Blocks (Cards)
     ============================================================ */
  .swagger-ui .opblock {
    border-radius: 12px;
    margin: 0 0 14px 0;
    background: #ffffff;
    border: 1.5px solid #e2e8f0;
    box-shadow: 0 2px 8px -2px rgba(15, 23, 42, 0.04);
    transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
    overflow: hidden;
  }

  .swagger-ui .opblock:hover {
    box-shadow: 0 6px 16px -2px rgba(15, 23, 42, 0.08);
  }

  .swagger-ui .opblock .opblock-summary {
    padding: 14px 20px;
    display: flex;
    align-items: center;
    gap: 14px;
    background: #ffffff;
    transition: background 0.2s ease;
  }

  .swagger-ui .opblock .opblock-summary:hover {
    background: #f8fafc;
  }

  .swagger-ui .opblock-summary-method {
    border-radius: 8px;
    font-weight: 700;
    min-width: 82px;
    height: 32px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    text-align: center;
    font-size: 13px;
    letter-spacing: 0.04em;
    color: #ffffff;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.08);
  }

  .swagger-ui .opblock-summary-path {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 14px;
    color: #0f172a;
    font-weight: 600;
  }

  .swagger-ui .opblock-summary-description {
    font-size: 13.5px;
    color: #64748b;
  }

  /* GET */
  .swagger-ui .opblock.opblock-get {
    border-color: #bfdbfe;
  }
  .swagger-ui .opblock.opblock-get .opblock-summary-method {
    background: linear-gradient(135deg, #3b82f6, #2563eb);
  }
  .swagger-ui .opblock.opblock-get.is-open {
    border-color: #60a5fa;
  }

  /* POST */
  .swagger-ui .opblock.opblock-post {
    border-color: #a7f3d0;
  }
  .swagger-ui .opblock.opblock-post .opblock-summary-method {
    background: linear-gradient(135deg, #10b981, #059669);
  }
  .swagger-ui .opblock.opblock-post.is-open {
    border-color: #34d399;
  }

  /* PUT */
  .swagger-ui .opblock.opblock-put {
    border-color: #fde68a;
  }
  .swagger-ui .opblock.opblock-put .opblock-summary-method {
    background: linear-gradient(135deg, #f59e0b, #d97706);
  }
  .swagger-ui .opblock.opblock-put.is-open {
    border-color: #fbbf24;
  }

  /* DELETE */
  .swagger-ui .opblock.opblock-delete {
    border-color: #fecaca;
  }
  .swagger-ui .opblock.opblock-delete .opblock-summary-method {
    background: linear-gradient(135deg, #ef4444, #dc2626);
  }
  .swagger-ui .opblock.opblock-delete.is-open {
    border-color: #f87171;
  }

  /* Lock Icon on Endpoints */
  .swagger-ui .authorization__btn {
    padding: 0 4px;
    background: none;
    border: none;
  }

  .swagger-ui .authorization__btn svg {
    fill: #64748b;
    width: 17px;
    height: 17px;
    transition: fill 0.2s;
  }

  .swagger-ui .authorization__btn:hover svg {
    fill: #4f46e5;
  }

  .swagger-ui .authorization__btn.locked svg {
    fill: #10b981;
  }

  /* ============================================================
     6. Operation Body & Interactive Console
     ============================================================ */
  .swagger-ui .opblock-body {
    background: #ffffff;
    border-top: 1px solid #f1f5f9;
    padding: 24px;
  }

  .swagger-ui .opblock-section-header {
    background: #f8fafc;
    border-radius: 8px;
    padding: 12px 18px;
    margin: 16px 0 20px 0;
    box-shadow: none;
    border: 1px solid #e2e8f0;
  }

  .swagger-ui .opblock-section-header h4 {
    font-size: 14px;
    font-weight: 700;
    color: #1e293b;
    letter-spacing: 0.02em;
    text-transform: uppercase;
  }

  /* Action Buttons */
  .swagger-ui .btn {
    border-radius: 8px;
    font-weight: 600;
    font-size: 13.5px;
    padding: 8px 18px;
    transition: all 0.2s ease;
    cursor: pointer;
  }

  .swagger-ui .btn.try-out__btn {
    background: #ffffff;
    border: 1.5px solid #2563eb;
    color: #2563eb;
  }

  .swagger-ui .btn.try-out__btn:hover {
    background: #2563eb;
    border-color: #2563eb;
    color: #ffffff;
    box-shadow: 0 2px 8px rgba(37, 99, 235, 0.25);
  }

  .swagger-ui .btn.try-out__btn.cancel {
    background: #f1f5f9;
    border-color: #cbd5e1;
    color: #475569;
  }

  .swagger-ui .btn.try-out__btn.cancel:hover {
    background: #e2e8f0;
    color: #0f172a;
  }

  .swagger-ui .btn.execute {
    background: linear-gradient(135deg, #10b981 0%, #059669 100%);
    border: none;
    color: #ffffff;
    box-shadow: 0 4px 12px rgba(16, 185, 129, 0.25);
    padding: 10px 24px;
    font-size: 14px;
  }

  .swagger-ui .btn.execute:hover {
    background: linear-gradient(135deg, #059669 0%, #047857 100%);
    box-shadow: 0 6px 16px rgba(16, 185, 129, 0.35);
    transform: translateY(-1px);
  }

  .swagger-ui .btn-clear {
    border-radius: 8px;
    font-weight: 600;
  }

  /* Table styling */
  .swagger-ui table {
    width: 100%;
    border-collapse: separate;
    border-spacing: 0;
    border: 1px solid #e2e8f0;
    border-radius: 10px;
    overflow: hidden;
  }

  .swagger-ui table thead tr th {
    background: #f8fafc;
    color: #334155;
    font-weight: 700;
    font-size: 13px;
    padding: 12px 16px;
    border-bottom: 1.5px solid #e2e8f0;
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }

  .swagger-ui table tbody tr td {
    padding: 14px 16px;
    border-bottom: 1px solid #f1f5f9;
    color: #334155;
    font-size: 14px;
  }

  .swagger-ui .parameter__name {
    font-weight: 700;
    color: #0f172a;
    font-size: 14px;
  }

  .swagger-ui .parameter__name.required::after {
    color: #ef4444;
  }

  .swagger-ui .parameter__type {
    color: #64748b;
    font-family: ui-monospace, SFMono-Regular, monospace;
    font-size: 12px;
  }

  .swagger-ui .parameter__in {
    font-size: 12px;
    color: #94a3b8;
    font-style: italic;
  }

  .swagger-ui input[type=text],
  .swagger-ui input[type=password],
  .swagger-ui textarea {
    border: 1.5px solid #cbd5e1;
    border-radius: 8px;
    padding: 9px 12px;
    font-size: 14px;
    color: #0f172a;
    background: #ffffff;
    transition: all 0.2s ease;
    outline: none;
  }

  .swagger-ui input[type=text]:focus,
  .swagger-ui input[type=password]:focus,
  .swagger-ui textarea:focus {
    border-color: #3b82f6;
    box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.15);
  }

  /* Response Status Badges */
  .swagger-ui .response-col_status {
    font-weight: 700;
    font-size: 14px;
  }

  .swagger-ui .response-col_status .response-col_status__inner {
    padding: 5px 12px;
    border-radius: 6px;
    font-family: ui-monospace, SFMono-Regular, monospace;
  }

  /* 2xx */
  .swagger-ui .response[data-code^="2"] .response-col_status .response-col_status__inner,
  .swagger-ui .response-col_status[data-code^="2"] {
    background: #dcfce7;
    color: #15803d;
  }

  /* 4xx */
  .swagger-ui .response[data-code^="4"] .response-col_status .response-col_status__inner,
  .swagger-ui .response-col_status[data-code^="4"] {
    background: #fef3c7;
    color: #b45309;
  }

  /* 5xx */
  .swagger-ui .response[data-code^="5"] .response-col_status .response-col_status__inner,
  .swagger-ui .response-col_status[data-code^="5"] {
    background: #fee2e2;
    color: #b91c1c;
  }

  /* ============================================================
     7. Code Blocks, cURL & Response Displays
     ============================================================ */
  .swagger-ui .highlight-code {
    background: #0f172a !important;
    border-radius: 10px;
    position: relative;
    border: 1px solid #1e293b;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
  }

  .swagger-ui .highlight-code .microlight {
    color: #e2e8f0 !important;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace !important;
    font-size: 13px !important;
    line-height: 1.65 !important;
    padding: 20px !important;
  }

  .swagger-ui .curl-command {
    background: #0f172a;
    border: 1.5px solid #10b981;
    border-radius: 10px;
    padding: 22px 20px 18px;
    margin: 20px 0;
    position: relative;
  }

  .swagger-ui .curl-command::before {
    content: "cURL";
    position: absolute;
    top: -11px;
    left: 16px;
    background: #10b981;
    color: #ffffff;
    padding: 2px 10px;
    border-radius: 4px;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.05em;
    text-transform: uppercase;
  }

  .swagger-ui .curl-command code {
    color: #e2e8f0;
    font-family: ui-monospace, SFMono-Regular, monospace;
    font-size: 13px;
    line-height: 1.6;
    word-break: break-all;
  }

  .swagger-ui .request-url {
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    padding: 14px 18px;
    margin: 16px 0;
  }

  .swagger-ui .request-url code {
    color: #0f172a;
    font-size: 13.5px;
    font-weight: 600;
    font-family: ui-monospace, SFMono-Regular, monospace;
  }

  /* Copy Button */
  .swagger-ui .copy-to-clipboard {
    position: absolute;
    top: 12px;
    right: 12px;
    z-index: 5;
  }

  .swagger-ui .copy-to-clipboard button {
    background: rgba(255, 255, 255, 0.1);
    backdrop-filter: blur(4px);
    border: 1px solid rgba(255, 255, 255, 0.2);
    color: #e2e8f0;
    padding: 6px 12px;
    border-radius: 6px;
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .swagger-ui .copy-to-clipboard button:hover {
    background: rgba(255, 255, 255, 0.2);
    color: #ffffff;
  }

  /* Long tokens (JWT) wrap cleanly */
  .swagger-ui .highlight-code,
  .swagger-ui .highlight-code > .microlight,
  .swagger-ui .responses-table .microlight,
  .swagger-ui .live-responses-table .microlight {
    max-height: none !important;
    overflow: visible !important;
    white-space: pre-wrap !important;
    word-break: break-all !important;
    overflow-wrap: anywhere !important;
    user-select: text !important;
    -webkit-user-select: text !important;
  }

  /* ============================================================
     8. Floating Test Variables Panel
     ============================================================ */
  .swg-vars {
    position: fixed;
    bottom: 20px;
    right: 20px;
    z-index: 9999;
    width: 250px;
    background: rgba(255, 255, 255, 0.95);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    color: #0f172a;
    border: 1px solid #e2e8f0;
    border-radius: 14px;
    padding: 14px 16px;
    box-shadow: 0 10px 25px -5px rgba(15, 23, 42, 0.12), 0 8px 10px -6px rgba(15, 23, 42, 0.05);
    font: 13px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    transition: all 0.2s ease;
  }

  .swg-vars:hover {
    box-shadow: 0 14px 30px -4px rgba(15, 23, 42, 0.18);
  }

  .swg-vars b {
    color: #059669;
    font-size: 12.5px;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    display: block;
    margin-bottom: 6px;
  }

  .swg-vars label {
    display: block;
    margin-top: 8px;
    color: #475569;
    font-weight: 500;
  }

  .swg-vars input {
    width: 100%;
    box-sizing: border-box;
    margin-top: 4px;
    padding: 7px 10px;
    border: 1.5px solid #cbd5e1;
    border-radius: 8px;
    font-size: 13px;
    color: #0f172a;
    background: #ffffff;
    outline: none;
    transition: border-color 0.2s ease;
  }

  .swg-vars input:focus {
    border-color: #10b981;
    box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.15);
  }

  /* ============================================================
     9. API Information Footer
     ============================================================ */
  .api-footer {
    max-width: 1440px;
    margin: 40px auto 0;
    padding: 0 20px 48px;
    color: #0f172a;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  }

  .api-footer-card {
    background: #ffffff;
    border: 1px solid #e2e8f0;
    border-top: 4px solid #10b981;
    border-radius: 16px;
    padding: 28px 36px;
    box-shadow: 0 4px 20px -2px rgba(15, 23, 42, 0.05);
  }

  .api-footer h2 {
    margin: 0 0 16px 0;
    font-size: 21px;
    font-weight: 700;
    color: #0f172a;
  }

  .api-footer-row {
    display: flex;
    flex-wrap: wrap;
    gap: 8px 12px;
    margin: 8px 0;
    font-size: 14.5px;
    color: #334155;
  }

  .api-footer-row .label {
    font-weight: 700;
    color: #0f172a;
    min-width: 160px;
  }

  .api-footer-row .value {
    color: #475569;
  }

  .api-footer-copy {
    margin-top: 20px;
    padding-top: 16px;
    border-top: 1px solid #f1f5f9;
    font-size: 13px;
    color: #94a3b8;
  }

  @media (max-width: 640px) {
    .swagger-ui .information-container { padding: 24px 20px; }
    .swagger-ui .scheme-container { padding: 14px 16px; }
    .api-footer-row .label { min-width: 100%; }
    .swg-vars { width: 210px; }
  }
`;
