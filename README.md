# My Representation

A deployable, independent civic accountability dashboard for U.S. federal representatives. Vanilla JavaScript frontend and Node.js/Express backend.

## Run locally

1. Install Node.js 20 or newer.
2. Request a free Congress.gov API key at https://api.congress.gov/sign-up/ .
3. Open a terminal in this folder and run `npm install`.
4. Set the environment variable `CONGRESS_API_KEY` to your key. On macOS/Linux: `export CONGRESS_API_KEY='your-key'`; on Windows PowerShell: `$env:CONGRESS_API_KEY='your-key'`.
5. Run `npm start` and open http://localhost:3000 .

The app loads `.env` **only if your hosting platform provides environment-file loading**; otherwise use an exported environment variable or hosting dashboard. `.env.example` is a template, not an automatic configuration file.

## Deploy

Deploy this directory to Render, Railway, Fly.io, or any Node 20+ hosting platform. Set build command `npm install`, start command `npm start`, and secret environment variable `CONGRESS_API_KEY`. The platform must allow outbound HTTPS requests. Do not publish your API key or commit a `.env` file. For production use, add request rate limiting, observability, a privacy notice, and persistent data storage if needed.

## Data and limitations

- **District matching:** U.S. Census Geocoding API. Requires full street address; ZIP codes alone are not reliable for congressional districts. Verify geocoder district vintage during redistricting and congressional transitions.
- **Members and sponsored bills:** Congress.gov v3 API. API key required. Congress.gov responses can change; check current endpoint schemas when upgrading.
- **House votes:** Congress.gov House vote beta API. The app attempts recent roll calls and individual member positions; beta API response shapes and coverage may change. Some votes may not be returned. Verify official House Clerk record links.
- **Senate votes:** Senate.gov XML vote menus and individual XML records. Matching is attempted using senator last name + state, because Senate LIS IDs are not Bioguide IDs. In unusual cases of name collisions, validate manually.
- **Ratings:** Browser localStorage only. The alignment number is the proportion of rated votes the user agrees with, not an approval rating. Browser data can be cleared; ratings are not synced between devices.
- **No AI bill summarization, statements matching, approval polling, notifications, or state/local voting integration in v1.** Official vote descriptions are shown instead of AI-generated summaries.
- **Important:** Voice votes and unrecorded actions cannot be assigned to individual lawmakers. Procedural votes should not be mistaken for votes on final passage. The current implementation fetches only a small recent subset, not complete history.

## Extending to Utah state and local government

Keep the UI's normalized `Member` and `Vote` objects. Add `providers/utah-legislature.js` and `providers/municipal.js` server adapters, each returning normalized member and vote objects with official-source URLs and freshness timestamps. Add a government level selector and ensure records include `jurisdiction`, `chamber`, `session`, `source`, `voteType`, and `recordedAt`. Municipal meeting minutes often contain non-roll-call decisions; label them accordingly.

## Privacy

The address is transmitted to this server and the Census geocoder for lookup. The server does not intentionally persist it, but hosting providers may retain access logs. Browser ratings and topics are stored locally. Avoid submitting addresses you do not have permission to use.
