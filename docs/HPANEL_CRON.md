# Run the queue through hPanel cron

Deploy the project including `scripts/worker-once.js` and `src/worker.js`.
The worker opens no HTTP port. Each invocation takes the existing database
worker lock, recovers interrupted jobs, schedules due work, processes a snapshot
of at most two queued jobs, checks publication again, and closes its database
connections before exiting. Overlapping invocations skip while the lock is held.

## Configure the web application

Set `WORKER_MODE=cron` in the Node.js application environment and restart it.
This prevents the web process from owning the queue lock. Keep the entry file
as `src/server.js`. Manual generation buttons still enqueue jobs normally.

## Create the custom cron command

Hostinger supports Node.js cron jobs through Advanced → Cron Jobs. For this
installation, using Node.js 22, enter this single command (214 characters):

```sh
/opt/alt/alt-nodejs22/root/bin/node --env-file=/home/u664454343/domains/autoblogging.snaprytr.com/hbuilds/config/.env /home/u664454343/domains/autoblogging.snaprytr.com/hbuilds/current/nodejs/scripts/worker-once.js
```

The paths follow Hostinger's documented active deployment and configuration
locations; verify they exist for this website. Use the same Node.js version
as the web app (22 or newer). The active deployment must contain the new script.
The environment file must contain the same production database and provider
configuration as the web application. Website environment variables are not
inherited automatically by cron. Do not paste API keys or a database URL into
the cron command; load them from the private environment file.

Choose every minute if permitted (`* * * * *`), or the shortest interval
available. Cron schedules minutes rather than five-second intervals. A manual
job starts on the next invocation unless another worker is busy. The scheduler
still follows each website's article cadence and budget.

Hostinger's `hbuilds/current/nodejs/` path points to the active deployment,
so the command does not pin an obsolete version folder. The worker resolves
media storage relative to the project, so it writes to the same `data/media/`
as the web app. Preserve this directory across deployments separately.

Source: https://www.hostinger.com/support/how-to-run-cron-jobs-for-node-js-websites-at-hostinger/

## Verify and inspect

Read the cron output in hPanel. If output is redirected to a log file, inspect it through File Manager.
Successful output includes `Starting job`, the final job status/stage, and
`Queue pass finished`. A final `failed` status means the pass executed but the
article needs inspection in Activity. `Skipped` means another worker owns the
lock; persistent skips after disabling the embedded worker need investigation.

Generation can exceed a cron interval: research, writing repairs and images
each have provider timeouts. Hostinger stops each cron invocation after 30 minutes. A hard hosting kill during a paid call cannot safely be
treated as a free retry; the next owner marks interrupted jobs failed for review.
This script does not remove hosting execution-time or persistent-storage limits.
Rotate or archive the log periodically to avoid unlimited disk usage.
