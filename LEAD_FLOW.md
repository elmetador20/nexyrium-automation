# Nexyrium lead capture

New direct WhatsApp conversations receive this opening reply once:

> Hi, thanks for reaching out to Nexyrium. Are you currently looking to build a website, mobile app, SaaS/product, or custom software solution, or do you need a pitch deck, brochure, or other design work?

After 30 seconds of inactivity, the AI analyses the customer's messages and saves the lead. Later replies are analysed again and update the same spreadsheet row.

## Google Sheets

New `Leads` tabs use these columns:

| Client Number | Date | Phone No | REQUIREMENTS | Salesperson |
| --- | --- | --- | --- | --- |
| 1 | 2026-10-06 | 919876543210 | Tech | Sharique |
| 2 | 2026-10-06 | 919876543211 | Pitch Deck | Arshan |

- **Client Number:** an automatically assigned sequence within the sheet. Updates and retries retain the same number.
- **Date:** the lead's original database creation date, formatted as `YYYY-MM-DD` in UTC.
- **Phone No:** the customer's WhatsApp phone number, stored as text to retain digits. The customer does not need to type their number.
- **REQUIREMENTS:** `Tech` or `Pitch Deck`. This stays empty until the customer expresses a supported requirement.
- **Salesperson:** the assigned person, selected using the sheet's dropdown labels.

On the first sync, a missing `Leads` tab or empty sheet is initialized with the new headers. A recognized old education-format sheet is duplicated to a timestamped `Leads archive ...` tab before its rows are converted. Existing phone numbers are retained and assigned client numbers. Old rows' dates and requirements stay empty because the education data did not contain them; subsequent conversations fill them in. Other layouts produce a sync error rather than being overwritten.

## Salesperson assignment

- New leads are automatically assigned in round-robin order: Sharique → Arshan → Ashutosh → Aryan → Sharique, using the order and exact capitalization of the existing dropdown when one is configured.
- The rotation is stored in the database and continues across backend restarts. Follow-up messages, sync retries, and dashboard reassignment do not advance the rotation for an already assigned lead.
- Existing selections in the sheet are imported into the database. Existing unassigned database leads with extracted data are assigned in batches of 10 by the retry worker, or by **Settings → Sync Now**.
- The dashboard shows an editable **Salesperson** dropdown in each lead row and in the lead detail panel. Selecting a name saves it in the database and updates the corresponding spreadsheet cell.
- If a spreadsheet write fails after saving an assignment, the dashboard shows **Sheet sync pending**, and the worker retries automatically. Lead lifecycle statuses are preserved during reassignment.
- Changing a selected name directly in Google Sheets is picked up when leads are refreshed; the dashboard polls every 30 seconds. A pending dashboard change takes priority until it has synced.

### Adding salespeople

The spreadsheet dropdown is the roster source. Both **Dropdown** (explicit names) and **Dropdown from a range** are supported. Add a new person to the dropdown list for the salesperson column, or append their name to the configured source range. The dashboard reloads names every minute and on focus; the backend validates the current list again when you reassign a lead.

Keep the same dropdown rule throughout the salesperson column, starting with its first data row. When using a range, exclude its header and use an open-ended range such as `Team!A2:A` if you want appended names to appear automatically.

If no dropdown exists, the backend initializes one with Sharique, Arshan, Ashutosh, and Aryan. New rows inherit the dropdown rule. Existing salesperson headers such as `Sales Person`, `Assigned To`, and `Assignee` are recognized in columns E:Z, and unrelated columns between requirements and the salesperson column are retained. If no salesperson column exists, one is added.

## Classification

| Customer request | REQUIREMENTS |
| --- | --- |
| Website, web app, mobile app, ecommerce | Tech |
| SaaS/product, custom software, APIs, automation | Tech |
| UI/UX design for a website or app | Tech |
| Pitch deck, investor deck, presentation | Pitch Deck |
| Brochure, flyer, poster, company profile | Pitch Deck |
| Logo, branding, standalone graphic/design work | Pitch Deck |
| Greeting only or unrelated enquiry | Empty until clarified |

The AI uses inbound customer messages as evidence. The opening reply's service list does not count as a customer requirement. Spelling mistakes and Hindi/Hinglish requests are supported. The latest clarification takes precedence. If the customer needs both a technical build and design collateral, the category is `Tech`, with both requests retained in the dashboard's requested-service details and notes.

The dashboard shows the new requirements and requested-service summary instead of education fields. Names, email addresses, notes, and conversation history remain available in the lead detail view.

## Apply the update

Start MySQL/MariaDB, then run these commands from the project root before restarting the backend:

```bash
npm run db:push
npm run db:generate
npm start
```

This synchronizes the local development database with the new assignment fields and the persisted rotation table. A deployment migration is also included in `prisma/migrations/20261007120000_add_salesperson_assignment/` for environments managed with Prisma migrations. The sheet layout is initialized or converted on the next sync. Rebuild/restart the dashboard to display the new fields.
