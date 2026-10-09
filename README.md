# Go Go EE Rangers

Open source class hub for announcements, schedule, to-dos with deadline countdowns, learning resources, activities, and contact information. Licensed under [MIT](LICENSE).

The UNIMAS logo in `assets/` is a university mark and is not covered by the MIT software license.

Node.js 24+ is required.

Set a private admin password, then start the server:

```powershell
node set-password.js
node server.js
```

Open `http://127.0.0.1:3000` for the class page and `http://127.0.0.1:3000/admin` to manage content. Use these server addresses instead of opening the HTML files directly. Announcements, schedule, to-dos, resources, activities, and contact text are saved in `data/class-hub.sqlite`. Task deadlines use Malaysia time (UTC+8); each visitor's check marks stay on their device. Keep the password private and back up that database file before moving the site to another computer.

## Vercel

The production site is [easypkee3.vercel.app](https://easypkee3.vercel.app). To deploy your own copy, create a Vercel project, connect a private Blob store, and set `ADMIN_PASSWORD` as a secret with at least 12 characters. Run `pnpm install` and `pnpm run deploy:vercel` from this folder. Vercel serves the six static files from `dist/` and runs `api/index.mjs` for `/api/*`. The admin content is saved in the connected private Blob store. The initial content is in `vercel/seed-content.json` until the first admin edit.

The online admin password is saved only in the ignored local file `data/vercel-admin-password.txt`. Open the production URL's `/admin` page to manage announcements, schedule, to-dos and due dates, resources, activities, and contact text. The local Node server has a separate password and database.
