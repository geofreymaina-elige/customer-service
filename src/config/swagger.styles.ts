export const swaggerCustomStyles = `
  .swagger-ui .topbar { display: none; }
  
  /* Background color matching the first image */
  body {
    background-color: #f5f7fa;
  }
  
  .swagger-ui {
    background-color: #f5f7fa;
  }
  
  /* Color scheme from AmbiaPay branding */
  .swagger-ui { 
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  }
  
  /* Main content wrapper */
  .swagger-ui .wrapper {
    background-color: #f5f7fa;
  }
  
  .swagger-ui .information-container {
    background: white;
    padding: 30px;
    border-radius: 8px;
    margin-bottom: 20px;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
  }
  
  /* Header styling */
  .swagger-ui .info { 
    margin: 30px 0;
  }
  
  .swagger-ui .info .title { 
    font-size: 36px;
    color: #1a1a1a;
    font-weight: 700;
    margin-bottom: 10px;
  }
  
  .swagger-ui .info .title small { 
    background: #10b981;
    color: white;
    padding: 4px 12px;
    border-radius: 20px;
    font-size: 14px;
    font-weight: 600;
    margin-left: 12px;
    vertical-align: middle;
  }
  
  .swagger-ui .info .description { 
    color: #4b5563;
    font-size: 15px;
    line-height: 1.7;
  }
  
  /* Scheme container */
  .swagger-ui .scheme-container { 
    background: #f9fafb;
    border: 1px solid #e5e7eb;
    border-radius: 8px;
    padding: 20px;
    margin: 20px 0;
  }
  
  /* Operations and tags */
  .swagger-ui .opblock-tag { 
    font-size: 20px;
    font-weight: 600;
    color: #1f2937;
    border-bottom: 2px solid #e5e7eb;
    padding: 15px 0;
    margin: 30px 0 15px 0;
  }
  
  .swagger-ui .opblock { 
    border: 1px solid #e5e7eb;
    border-radius: 8px;
    margin: 0 0 15px 0;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
  }
  
  /* HTTP method colors */
  .swagger-ui .opblock.opblock-get { 
    border-color: #3b82f6;
    background: rgba(59, 130, 246, 0.02);
  }
  
  .swagger-ui .opblock.opblock-get .opblock-summary-method { 
    background: #3b82f6;
  }
  
  .swagger-ui .opblock.opblock-post { 
    border-color: #10b981;
    background: rgba(16, 185, 129, 0.02);
  }
  
  .swagger-ui .opblock.opblock-post .opblock-summary-method { 
    background: #10b981;
  }
  
  .swagger-ui .opblock.opblock-put { 
    border-color: #f59e0b;
    background: rgba(245, 158, 11, 0.02);
  }
  
  .swagger-ui .opblock.opblock-put .opblock-summary-method { 
    background: #f59e0b;
  }
  
  .swagger-ui .opblock.opblock-delete { 
    border-color: #ef4444;
    background: rgba(239, 68, 68, 0.02);
  }
  
  .swagger-ui .opblock.opblock-delete .opblock-summary-method { 
    background: #ef4444;
  }
  
  /* Operation summary */
  .swagger-ui .opblock-summary { 
    padding: 12px 20px;
    cursor: pointer;
  }
  
  .swagger-ui .opblock-summary-method { 
    border-radius: 6px;
    font-weight: 700;
    min-width: 80px;
    text-align: center;
    font-size: 13px;
  }
  
  .swagger-ui .opblock-summary-path { 
    font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
    font-size: 14px;
    color: #1f2937;
    font-weight: 600;
  }
  
  .swagger-ui .opblock-summary-description { 
    font-size: 14px;
    color: #6b7280;
  }
  
  /* Buttons */
  .swagger-ui .btn { 
    border-radius: 6px;
    font-weight: 600;
    font-size: 14px;
    padding: 8px 16px;
  }
  
  .swagger-ui .btn.execute { 
    background: #10b981;
    border-color: #10b981;
  }
  
  .swagger-ui .btn.execute:hover { 
    background: #059669;
    border-color: #059669;
  }
  
  .swagger-ui .btn.try-out__btn { 
    background: #3b82f6;
    border-color: #3b82f6;
    color: white;
  }
  
  .swagger-ui .btn.try-out__btn:hover { 
    background: #2563eb;
    border-color: #2563eb;
  }
  
  /* Authorization button */
  .swagger-ui .btn.authorize { 
    background: #8b5cf6;
    border-color: #8b5cf6;
  }
  
  .swagger-ui .btn.authorize svg { 
    fill: white;
  }
  
  .swagger-ui .btn.authorize:hover { 
    background: #7c3aed;
    border-color: #7c3aed;
  }
  
  /* Parameters and responses */
  .swagger-ui .parameters-col_description { 
    color: #4b5563;
    font-size: 14px;
  }
  
  .swagger-ui .parameter__name { 
    font-weight: 600;
    color: #1f2937;
  }
  
  .swagger-ui .parameter__type { 
    color: #6b7280;
    font-size: 12px;
  }
  
  .swagger-ui .response-col_status { 
    font-weight: 700;
    font-size: 14px;
  }
  
  .swagger-ui .response-col_status .response-col_status__inner { 
    padding: 4px 12px;
    border-radius: 6px;
  }
  
  /* Response codes */
  .swagger-ui .responses-inner h4, .swagger-ui .responses-inner h5 { 
    font-size: 14px;
    font-weight: 600;
    color: #1f2937;
    margin: 20px 0 10px 0;
  }
  
  /* Code blocks */
  .swagger-ui .highlight-code { 
    background: #1f2937;
    border-radius: 6px;
  }
  
  .swagger-ui .highlight-code .microlight { 
    color: #e5e7eb;
    font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
    font-size: 13px;
    padding: 16px;
  }
  
  /* Models */
  .swagger-ui .model-box { 
    background: #f9fafb;
    border-radius: 6px;
    padding: 16px;
  }
  
  .swagger-ui .model-title { 
    color: #1f2937;
    font-weight: 600;
  }
  
  .swagger-ui .model { 
    font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
    font-size: 13px;
  }
  
  /* Tables */
  .swagger-ui table { 
    border-collapse: collapse;
  }
  
  .swagger-ui table thead tr th { 
    background: #f9fafb;
    color: #1f2937;
    font-weight: 600;
    font-size: 13px;
    padding: 12px;
    border-bottom: 2px solid #e5e7eb;
  }
  
  .swagger-ui table tbody tr td { 
    padding: 12px;
    border-bottom: 1px solid #e5e7eb;
    color: #4b5563;
    font-size: 14px;
  }
  
  /* Authorization modal */
  .swagger-ui .dialog-ux { 
    border-radius: 8px;
    box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
  }
  
  .swagger-ui .modal-ux-header { 
    background: #f9fafb;
    border-bottom: 2px solid #e5e7eb;
    padding: 20px;
  }
  
  .swagger-ui .modal-ux-header h3 { 
    color: #1f2937;
    font-weight: 600;
  }
  
  .swagger-ui .modal-ux-content { 
    padding: 20px;
  }
  
  /* Links */
  .swagger-ui a { 
    color: #3b82f6;
    text-decoration: none;
  }
  
  .swagger-ui a:hover { 
    color: #2563eb;
    text-decoration: underline;
  }
  
  /* Markdown content */
  .swagger-ui .markdown p { 
    margin: 0 0 12px 0;
    line-height: 1.7;
  }
  
  .swagger-ui .markdown code { 
    background: #f3f4f6;
    color: #ef4444;
    padding: 2px 6px;
    border-radius: 4px;
    font-size: 0.9em;
    font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
  }
  
  .swagger-ui .markdown pre { 
    background: #1f2937;
    padding: 16px;
    border-radius: 6px;
    overflow-x: auto;
  }
  
  .swagger-ui .markdown pre code { 
    background: transparent;
    color: #e5e7eb;
    padding: 0;
  }
  
  .swagger-ui .markdown h1 { 
    font-size: 28px;
    font-weight: 700;
    color: #1a1a1a;
    margin: 30px 0 15px 0;
    border-bottom: 2px solid #e5e7eb;
    padding-bottom: 10px;
  }
  
  .swagger-ui .markdown h2 { 
    font-size: 22px;
    font-weight: 600;
    color: #1f2937;
    margin: 25px 0 12px 0;
  }
  
  .swagger-ui .markdown h3 { 
    font-size: 18px;
    font-weight: 600;
    color: #374151;
    margin: 20px 0 10px 0;
  }
  
  .swagger-ui .markdown ul, .swagger-ui .markdown ol { 
    margin: 0 0 12px 20px;
    padding-left: 20px;
  }
  
  .swagger-ui .markdown li { 
    margin: 6px 0;
    line-height: 1.6;
  }
  
  .swagger-ui .markdown hr { 
    border: none;
    border-top: 2px solid #e5e7eb;
    margin: 30px 0;
  }
  
  /* Server selection */
  .swagger-ui select { 
    border: 1px solid #d1d5db;
    border-radius: 6px;
    padding: 8px 12px;
    font-size: 14px;
    color: #1f2937;
  }
  
  /* Input fields */
  .swagger-ui input[type=text], 
  .swagger-ui input[type=password], 
  .swagger-ui textarea { 
    border: 1px solid #d1d5db;
    border-radius: 6px;
    padding: 8px 12px;
    font-size: 14px;
    color: #1f2937;
  }
  
  .swagger-ui input[type=text]:focus, 
  .swagger-ui input[type=password]:focus, 
  .swagger-ui textarea:focus { 
    border-color: #3b82f6;
    outline: none;
    box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
  }
  
  /* curl Command Section */
  .swagger-ui .curl-command {
    background: #1f2937;
    border: 2px solid #10b981;
    border-radius: 8px;
    padding: 20px;
    margin: 20px 0;
    position: relative;
  }
  
  .swagger-ui .curl-command::before {
    content: "cURL Command";
    position: absolute;
    top: -12px;
    left: 16px;
    background: #10b981;
    color: white;
    padding: 4px 12px;
    border-radius: 4px;
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.5px;
  }
  
  .swagger-ui .curl-command pre {
    margin: 0;
    background: transparent;
    padding: 8px 0 0 0;
  }
  
  .swagger-ui .curl-command code {
    color: #e5e7eb;
    font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
    font-size: 13px;
    line-height: 1.6;
    word-break: break-all;
  }
  
  /* Request URL Section */
  .swagger-ui .request-url {
    background: #f9fafb;
    border: 1px solid #e5e7eb;
    border-radius: 6px;
    padding: 16px;
    margin: 16px 0;
  }
  
  .swagger-ui .request-url pre {
    margin: 0;
    background: transparent;
    padding: 0;
  }
  
  .swagger-ui .request-url code {
    color: #1f2937;
    font-size: 14px;
    font-weight: 500;
  }
  
  /* Copy to clipboard button styling */
  .swagger-ui .copy-to-clipboard {
    position: absolute;
    top: 16px;
    right: 16px;
  }
  
  .swagger-ui .copy-to-clipboard button {
    background: #374151;
    border: 1px solid #4b5563;
    color: #e5e7eb;
    padding: 6px 12px;
    border-radius: 4px;
    font-size: 12px;
    cursor: pointer;
    transition: all 0.2s;
  }
  
  .swagger-ui .copy-to-clipboard button:hover {
    background: #4b5563;
    border-color: #6b7280;
  }
  
  /* Responses section - ensure curl appears above */
  .swagger-ui .responses-wrapper {
    margin-top: 24px;
  }
  
  .swagger-ui .responses-wrapper .responses-inner {
    padding-top: 16px;
    border-top: 2px solid #e5e7eb;
  }
  
  /* Live Response section */
  .swagger-ui .live-responses-table {
    margin-top: 20px;
  }
  
  /* Request snippet section */
  .swagger-ui .request-snippet {
    margin: 20px 0;
    border: 2px solid #3b82f6;
    border-radius: 8px;
    overflow: hidden;
  }
  
  .swagger-ui .request-snippet .snippet__title {
    background: #3b82f6;
    color: white;
    padding: 10px 16px;
    font-weight: 600;
    font-size: 13px;
    letter-spacing: 0.5px;
  }
  
  .swagger-ui .request-snippet select {
    margin-left: 12px;
    background: rgba(255, 255, 255, 0.2);
    color: white;
    border: 1px solid rgba(255, 255, 255, 0.3);
    padding: 4px 8px;
    border-radius: 4px;
    font-size: 12px;
  }
  
  .swagger-ui .request-snippet pre {
    margin: 0;
    background: #1f2937;
    padding: 20px;
  }
  
  .swagger-ui .request-snippet code {
    color: #e5e7eb;
    font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
    font-size: 13px;
    line-height: 1.6;
  }
`;
