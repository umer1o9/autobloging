# Social publishing

In **Websites → Social publishing → Configure Meta app**, enter the Meta App ID and App Secret for the website. The app secret is saved in the server database and is never returned to the browser. Register AutoBlog Studio’s HTTPS origin plus `/facebook/callback` as the exact valid OAuth redirect URI in Meta. Save the settings, log in with Facebook, select a Page, then enable automatic publishing. The steps below also describe the manual Page-token setup.


AutoBlog Studio creates captions for the networks selected under **Websites → Social publishing**. Facebook Page posts can be sent automatically through Meta's Graph API. Instagram, LinkedIn, Reddit, TikTok and YouTube have copyable drafts for manual posting.

1. In the [Meta developer dashboard](https://developers.facebook.com/apps/), create or use a Meta app and authorize it for your Facebook Page. Obtain a Page access token for a Page you manage. The Page Feed permissions include `pages_manage_posts` and `pages_read_engagement`. Your app's user roles and Meta review requirements govern who can authorize it. See the [Page Feed requirements](https://developers.facebook.com/docs/graph-api/reference/page/feed/).
2. Set `FACEBOOK_PAGE_CONNECTIONS` on the web process and cron worker. Use your AutoBlog Studio website ID as the JSON key. Keep the Page token in the server environment.

   ```dotenv
   FACEBOOK_PAGE_CONNECTIONS={"YOUR_WEBSITE_UUID":{"pageId":"YOUR_NUMERIC_PAGE_ID","accessToken":"YOUR_PAGE_ACCESS_TOKEN"}}
   ```

3. Restart AutoBlog Studio. Select the website, open **Social publishing**, and click **Check linked accounts**. This verifies the token can read the configured Page. The first publish verifies posting permissions.
4. Select **Facebook Page**, set the public article path, such as `/blog/{slug}.html`, and enable automatic Facebook publishing. The existing worker waits until the article is published and its public HTML contains a matching main heading.

After a timeout or interrupted send, check the Facebook Page before posting again. Unpublishing an article cancels unsent posts. Remove already published social posts from the destination itself.

## LinkedIn profile publishing

Open **Websites → Social publishing → Configure LinkedIn app**. In the LinkedIn Developer Portal, enable **Share on LinkedIn** and **Sign In with LinkedIn using OpenID Connect**. In the Auth tab, register the exact HTTPS callback shown in the form, for example `https://autoblogging.snaprytr.com/linkedin/callback`. Save the Client ID and Client Secret in the form, then click **Connect LinkedIn** on the hosted app and grant consent.

Select **LinkedIn profile**, enter your public article path, and enable automatic publishing. The worker shares the article link once the public blog page is live. Reconnect when the token expires. This integration publishes to the authenticated member profile.
