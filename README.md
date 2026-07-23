# USW Scientist Survey

Interactive test implementation of **Scientist Survey v2.0** for the University of Scientific Workflow project.

The page includes all nine survey sections, conditional branching, validation, progress tracking, a repeatable tool inventory, and an interactive D0 workflow builder with ordered stages, branches, and loops. A respondent can save, receive a recovery key, reopen, edit, and resubmit a versioned response.

## Important: prototype storage

The current page is intentionally a test prototype. Responses are stored in the respondent's browser with `localStorage`; the recovery key is hashed before it is used as the local record identifier. Nothing is transmitted to the research team, and a key can recover a response only in the same browser profile.

Do not recruit real participants or collect real identity data with this build. Before production use, connect the storage interface in `storage.js` to a server-side API and complete the applicable ethics/IRB, consent, retention, deletion, access-control, and incident-response review.

The production API should, at minimum:

- accept draft saves and submissions over HTTPS;
- store only a slow, salted hash of each recovery key;
- keep eligibility identity fields separate from analysis responses;
- support load-by-key, edit, revision history, retention, and deletion;
- rate-limit requests, validate the schema server-side, encrypt backups, and produce an audit trail;
- never expose a database service key or administrative credential in this repository or the browser bundle.

## Run locally

Serve the directory over HTTP because the app uses browser ES modules:

```sh
python3 -m http.server 8000
```

Then open `http://localhost:8000`.

## Test

No runtime build step or JavaScript dependency is required. With Node.js 20 or newer:

```sh
npm test
```

## GitHub Pages

For a public repository named `usw_scientist_survey` under the `minnesotanlp` organization, the expected Pages URL is:

`https://minnesotanlp.github.io/usw_scientist_survey/`

Publish from the repository's `main` branch and root directory. The included `.nojekyll` file keeps GitHub Pages from applying Jekyll processing.

## Source and design direction

- Survey content: the `Scientist Survey v2.0` tab of the USW project document.
- Interface direction: compact monochrome research dashboard, teal accent, sharp cards, and dense status panels inspired by the referenced TB Science Task Dashboard.
- Example-person answers and internal reviewer notes from the project document are not included.
