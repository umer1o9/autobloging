# Hostinger VPS deployment

AutoBlog Studio needs a persistent Node.js process for its scheduler and persistent storage for generated files in `data/media/`. Use a Hostinger VPS. Hostinger's managed Web/Cloud Node.js product does not support always-running background workers and creates a new build folder for each deployment.

The recommended layout is:

```text
Internet -> HTTPS domain -> CloudPanel reverse proxy -> Node.js on 127.0.0.1:3210
                                                     -> MySQL 8 on 127.0.0.1:3306
                                                     -> persistent data/media directory
```

## 1. Create the VPS and domain

1. Create a Hostinger VPS with Ubuntu and CloudPanel.
2. In CloudPanel, add a Node.js site for a dedicated domain or subdomain such as `autoblog.example.com`.
3. Select Node.js 22 and app port `3210`.
4. Point the domain's DNS A record to the VPS IP.
5. Enable the free Let's Encrypt certificate in CloudPanel.

Only ports 22, 80, and 443 should be public. Keep Node port 3210 and MySQL port 3306 bound to localhost.

## 2. Upload the application

Upload or clone only the runtime project files into the CloudPanel site directory:

```text
package.json
package-lock.json
src/
public/
migrations/
scripts/migrate.js
data/media/        # required when moving existing generated images
```

Do not upload `.env`, `node_modules`, local MySQL files, database backups, tests, or unrelated working files.

Install dependencies as the CloudPanel site user:

```sh
cd ~/htdocs/autoblog.example.com
npm ci --omit=dev
```

## 3. Create the production MySQL database

Create a dedicated database and account. Do not run the application as MySQL root.

```sql
CREATE DATABASE autoblog CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'autoblog_app'@'127.0.0.1' IDENTIFIED BY 'REPLACE_WITH_A_LONG_RANDOM_PASSWORD';
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, REFERENCES
  ON autoblog.* TO 'autoblog_app'@'127.0.0.1';
FLUSH PRIVILEGES;
```

The account needs the schema permissions for the initial migration. They can be removed after migrations if a separate schema-owner account is used through `MIGRATION_DATABASE_URL`.

## 4. Create the production environment file

Create a private `.env` file on the VPS and make it readable only by the site user:

```dotenv
HOST=127.0.0.1
PORT=3210
APP_ORIGIN=https://autoblog.example.com
DATABASE_URL=mysql://autoblog_app:URL_ENCODED_PASSWORD@127.0.0.1:3306/autoblog
MYSQL_SSL=false

GEMINI_API_KEY=replace_me
GEMINI_RESEARCH_MODEL=gemini-3.5-flash-lite
GEMINI_WRITER_MODEL=gemini-3.5-flash-lite
GEMINI_REPAIR_MODEL=gemini-3.8-flash
GEMINI_IMAGE_MODEL=gemini-3.1-flash-lite-image

# Optional when OpenAI image generation is required.
OPENAI_API_KEY=
OPENAI_IMAGE_MODEL=gpt-image-2.5-flare

ALLOW_PAID_GENERATION=true
DISABLE_REGISTRATION=false
```

URL-encode reserved characters in the MySQL password. Never commit or upload the local `.env` file to a public repository.

```sh
chmod 600 .env
npm run db:migrate
npm run check
```

## 5. Keep the application and scheduler running

Install PM2 once and start the application:

```sh
npm install --global pm2
pm2 start npm --name autoblog-studio --cwd "$PWD" -- start
pm2 save
pm2 startup
```

Run the command printed by `pm2 startup`, then run `pm2 save` again. This starts AutoBlog Studio after a VPS reboot and keeps the automatic article worker running.

Useful operations:

```sh
pm2 status
pm2 logs autoblog-studio
pm2 restart autoblog-studio
curl -fsS https://autoblog.example.com/health
```

The health endpoint should return `{"status":"ok"}`.

## 6. Finish account setup

1. Open `https://autoblog.example.com`.
2. Register or sign in to the administrator account.
3. Verify websites, automation, Gemini models, image settings, and the Delivery API.
4. Set `DISABLE_REGISTRATION=true` in `.env` after the required administrator accounts exist.
5. Run `pm2 restart autoblog-studio`.

## 7. Move the current local content

To preserve the current accounts, websites, jobs, and articles, stop local writes first and export the local database:

```sh
mysqldump --single-transaction --default-character-set=utf8mb4 \
  -h 127.0.0.1 -P 3306 -u root autoblog | gzip > autoblog.sql.gz
```

Copy the SQL archive and `data/media/` to the VPS over SSH. Import the database before starting the production process:

```sh
gzip -dc autoblog.sql.gz | mysql -h 127.0.0.1 -u autoblog_app -p autoblog
```

Preserve the media directory paths and ownership so existing article image URLs continue to resolve through `/media/{filename}`.

## 8. Backups and deployment checks

Back up both MySQL and generated media. A database-only backup is incomplete because image binaries are stored on disk.

Before enabling automatic generation in production, verify:

- HTTPS and `/health` work.
- Login and logout work using the public hostname.
- MySQL is not publicly reachable.
- `data/media` remains writable and persists through deployments.
- PM2 restarts the process after a reboot.
- A manual Run now job completes research, writing, validation, images, publication, and Delivery API retrieval.
- Provider billing limits and alerts are configured in Google AI Studio and OpenAI.
- Automated database and media backups are stored outside the VPS and a restore has been tested.

This version records budget reservations but does not enforce provider billing caps. Provider-side spending limits remain necessary.
