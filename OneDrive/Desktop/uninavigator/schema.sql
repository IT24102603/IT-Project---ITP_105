-- UniNavigator schema (MySQL)
CREATE DATABASE IF NOT EXISTS uniNavigator;
USE uniNavigator;

CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  password VARCHAR(255) NOT NULL,
  index_number VARCHAR(100) DEFAULT NULL,
  profile_pic TEXT DEFAULT NULL,
  target_attendance INT DEFAULT 80,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS modules (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  name VARCHAR(255) NOT NULL,
  code VARCHAR(50) DEFAULT NULL,
  semester INT DEFAULT 1,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS attendance (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  module_name VARCHAR(255) NOT NULL,
  attended INT NOT NULL DEFAULT 0,
  total_sessions INT NOT NULL DEFAULT 0,
  semester INT DEFAULT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- If you already have users table, run these to add new columns (ignore errors if column exists):
-- ALTER TABLE users ADD COLUMN index_number VARCHAR(100) DEFAULT NULL;
-- ALTER TABLE users ADD COLUMN profile_pic TEXT DEFAULT NULL;
-- ALTER TABLE users ADD COLUMN target_attendance INT DEFAULT 80;
