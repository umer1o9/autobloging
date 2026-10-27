CREATE TABLE IF NOT EXISTS workspaces (
 id VARCHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
 name VARCHAR(100) NOT NULL,
 created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS users (
 id VARCHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
 email VARCHAR(254) NOT NULL UNIQUE,
 password_hash VARCHAR(256) NOT NULL,
 workspace_id VARCHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 name VARCHAR(100) NOT NULL,
 FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS sessions (
 token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
 user_id VARCHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 expires_at BIGINT NOT NULL,
 INDEX session_expiry (expires_at),
 FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS websites (
 id VARCHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
 workspace_id VARCHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 name VARCHAR(100) NOT NULL,
 api_key_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
 payload JSON NOT NULL,
 created_at CHAR(24) CHARACTER SET ascii NOT NULL,
 UNIQUE KEY website_scope (workspace_id,id),
 INDEX website_delivery (id,api_key_hash),
 FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS topics (
 id VARCHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
 workspace_id VARCHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 site_id VARCHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 normalized_title VARCHAR(200) COLLATE utf8mb4_bin NOT NULL,
 status VARCHAR(24) NOT NULL,
 payload JSON NOT NULL,
 created_at CHAR(24) CHARACTER SET ascii NOT NULL,
 UNIQUE KEY topic_title (site_id,normalized_title),
 UNIQUE KEY topic_scope (workspace_id,site_id,id),
 INDEX topic_queue (workspace_id,site_id,status,created_at),
 FOREIGN KEY (workspace_id,site_id) REFERENCES websites(workspace_id,id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS articles (
 id VARCHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
 workspace_id VARCHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 site_id VARCHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 topic_id VARCHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 slug VARCHAR(150) CHARACTER SET ascii COLLATE ascii_bin NULL,
 status VARCHAR(24) NOT NULL,
 revision INT UNSIGNED NOT NULL,
 approved_revision INT UNSIGNED NULL,
 scheduled_at CHAR(24) CHARACTER SET ascii NULL,
 published_at CHAR(24) CHARACTER SET ascii NULL,
 occupied_slot VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin GENERATED ALWAYS AS (CASE WHEN status='scheduled' THEN RTRIM(scheduled_at) ELSE NULL END) STORED,
 payload JSON NOT NULL,
 created_at CHAR(24) CHARACTER SET ascii NOT NULL,
 UNIQUE KEY article_topic (topic_id),
 UNIQUE KEY article_slug (site_id,slug),
 UNIQUE KEY article_slot (site_id,occupied_slot),
 UNIQUE KEY article_scope (workspace_id,id),
 INDEX article_delivery (workspace_id,site_id,status,published_at,id),
 INDEX article_due (status,scheduled_at),
 FOREIGN KEY (workspace_id,site_id,topic_id) REFERENCES topics(workspace_id,site_id,id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS jobs (
 id VARCHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
 workspace_id VARCHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 site_id VARCHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 topic_id VARCHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 status VARCHAR(24) NOT NULL,
 reserved_cents INT UNSIGNED NOT NULL,
 active_topic VARCHAR(36) CHARACTER SET ascii COLLATE ascii_bin GENERATED ALWAYS AS (CASE WHEN status IN ('queued','running') THEN topic_id ELSE NULL END) STORED,
 payload JSON NOT NULL,
 created_at CHAR(24) CHARACTER SET ascii NOT NULL,
 UNIQUE KEY one_active_job (active_topic),
 UNIQUE KEY job_scope (workspace_id,site_id,id),
 INDEX job_queue (status,created_at),
 INDEX job_budget (workspace_id,site_id,created_at,status),
 FOREIGN KEY (workspace_id,site_id,topic_id) REFERENCES topics(workspace_id,site_id,id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS approvals (
 article_id VARCHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 revision INT UNSIGNED NOT NULL,
 workspace_id VARCHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 reviewer_id VARCHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 reviewed_at CHAR(24) CHARACTER SET ascii NOT NULL,
 invalidated_at CHAR(24) CHARACTER SET ascii NULL,
 PRIMARY KEY(article_id,revision),
 FOREIGN KEY(workspace_id,article_id) REFERENCES articles(workspace_id,id)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS usage_records (
 job_id VARCHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 call_index INT UNSIGNED NOT NULL,
 workspace_id VARCHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 site_id VARCHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 stage VARCHAR(40) NOT NULL,
 payload JSON NOT NULL,
 PRIMARY KEY(job_id,call_index),
 FOREIGN KEY(workspace_id,site_id,job_id) REFERENCES jobs(workspace_id,site_id,id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS audit_events (
 id VARCHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
 workspace_id VARCHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 site_id VARCHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 action VARCHAR(64) NOT NULL,
 entity_id VARCHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 created_at CHAR(24) CHARACTER SET ascii NOT NULL,
 INDEX audit_scope (workspace_id,site_id,created_at),
 FOREIGN KEY(workspace_id,site_id) REFERENCES websites(workspace_id,id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS coordination_locks (
 lock_key VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS data_imports (
 source_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
 counts JSON NOT NULL,
 imported_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB;
