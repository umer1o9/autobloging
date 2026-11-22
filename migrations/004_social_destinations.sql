ALTER TABLE social_posts
 ADD COLUMN destination VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT '',
 DROP INDEX social_article_platform,
 ADD UNIQUE KEY social_article_platform (article_id,platform,destination);
