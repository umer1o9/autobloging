CREATE TABLE IF NOT EXISTS social_posts (
 id VARCHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
 workspace_id VARCHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 site_id VARCHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 article_id VARCHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 platform VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 status VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 next_at CHAR(24) CHARACTER SET ascii NOT NULL,
 payload JSON NOT NULL,
 UNIQUE KEY social_article_platform (article_id,platform),
 INDEX social_queue (status,next_at),
 INDEX social_website (workspace_id,site_id,next_at),
 FOREIGN KEY (workspace_id,article_id) REFERENCES articles(workspace_id,id) ON DELETE CASCADE,
 FOREIGN KEY (workspace_id,site_id) REFERENCES websites(workspace_id,id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
