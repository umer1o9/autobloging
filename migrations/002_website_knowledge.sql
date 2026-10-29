CREATE TABLE IF NOT EXISTS website_knowledge (
 workspace_id VARCHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 site_id VARCHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 payload JSON NOT NULL,
 PRIMARY KEY (workspace_id,site_id),
 FOREIGN KEY (workspace_id,site_id) REFERENCES websites(workspace_id,id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS website_pages (
 workspace_id VARCHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 site_id VARCHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 run_id VARCHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 url_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 payload JSON NOT NULL,
 PRIMARY KEY (workspace_id,site_id,run_id,url_hash),
 FOREIGN KEY (workspace_id,site_id) REFERENCES websites(workspace_id,id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
