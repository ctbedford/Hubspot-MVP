# HubSpot CRM Relationship Mapper MVP

This project is a React application designed to analyze and visualize HubSpot CRM data, focusing on deal revenue, company relationships, and brand attribution.

## Project Setup

1.  **Ensure you have Node.js and npm (or Yarn) installed.**

2.  **Create Project Directory Structure:**
    If they don't already exist, manually create the following directories in your project root (`/Users/tylerbedford/Documents/Coding Projects/Hubspot MVP/`):
    *   `public`
    *   `src`

3.  **Place CSV Data Files:**
    Move your HubSpot data files into the `public` directory:
    *   `public/tylerdeals.csv`
    *   `public/hubspotcrmexportstylercompanies20250529.csv`
    *   `public/hubspotcrmexportsmydeals202505272 2.csv`

4.  **Create Core Application Files:**
    Manually create the following files with the content provided during our session:
    *   `package.json` (in the project root)
    *   `tailwind.config.js` (in the project root)
    *   `postcss.config.js` (in the project root)
    *   `public/index.html`
    *   `src/index.css`
    *   `src/index.js`
    *   `src/App.js`
    *   (Optional) You can create `src/reportWebVitals.js` if you want to use web vitals, or remove its import from `src/index.js`. For simplicity, the content for `reportWebVitals.js` is standard Create React App boilerplate, which you can find online or omit.

5.  **Install Dependencies:**
    Open your terminal in the project root directory (`/Users/tylerbedford/Documents/Coding Projects/Hubspot MVP/`) and run:
    ```bash
    npm install
    ```
    or if you use Yarn:
    ```bash
    yarn install
    ```

6.  **Start the Development Server:**
    Once dependencies are installed, run:
    ```bash
    npm start
    ```
    or
    ```bash
    yarn start
    ```
    This will open the application in your web browser, usually at `http://localhost:3000`.

## Key Features

*   Loads and parses CSV data for deals, companies, and reference deals.
*   Multiple data mapping strategies:
    *   **Enhanced ID Mapping:** Uses a reference dataset to map deals to companies.
    *   **Domain Analysis:** Infers parent-child company relationships based on shared email domains.
    *   **Brand Attribution:** Calculates revenue and associated companies per brand.
    *   **Revenue Validation:** Compares declared company revenue with calculated revenue from deals.
*   Interactive UI with tabs for different analysis views (Overview, ID Mapping, Domain Analysis, etc.).
*   Visualizations (bar charts, pie charts, scatter plots) using Recharts.
*   Search functionality to filter relationships.
*   Styled with Tailwind CSS.

## CSV File Notes

*   The application expects the CSV files to be named exactly as listed above and placed in the `public` folder.
*   The parsing logic relies on specific column headers (e.g., 'Deal Name', 'Campaign Brand', 'Associated Company IDs (Primary)', 'Company name', 'Company Domain Name', 'Total Revenue', 'Amount', 'Budget', 'Deal Stage', 'Pipeline', 'Record ID'). Ensure your CSVs match these or update the code accordingly.

If you encounter any issues, please check the browser's developer console for error messages.
