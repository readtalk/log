-- Migration number: 0002 - 2025-12-27 - Add profile columns
ALTER TABLE user ADD COLUMN username TEXT UNIQUE;
ALTER TABLE user ADD COLUMN full_name TEXT;
