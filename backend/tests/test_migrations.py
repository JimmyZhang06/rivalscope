"""SQLite 启动迁移的离线回归测试。

所有测试使用内存数据库，不会读写 research.db。
"""

import os
import unittest

from sqlalchemy import create_engine
from sqlalchemy.pool import StaticPool


# app.main 在 import 时会校验配置并创建配置的数据库。在导入前强制
# 使用内存 SQLite，确保测试不会触及真实数据。
os.environ["DATABASE_URL"] = "sqlite:///:memory:"
os.environ["JWT_SECRET"] = "offline-test-secret-that-is-at-least-32-chars"
os.environ.setdefault("APP_ENV", "test")

from app.main import _fix_column_order_if_needed  # noqa: E402


class MigrationSafetyTests(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine("sqlite:///:memory:", poolclass=StaticPool)

    def tearDown(self) -> None:
        self.engine.dispose()

    def test_rebuild_preserves_constraints_defaults_indexes_triggers_and_data(self) -> None:
        with self.engine.connect() as conn:
            conn.exec_driver_sql("PRAGMA foreign_keys=OFF")
            conn.exec_driver_sql("BEGIN IMMEDIATE")
            # email/id 故意反序，reset_code 故意使用旧类型。其余列与 User
            # 模型对齐，以隔离测试重建本身的行为。
            conn.exec_driver_sql("""
                CREATE TABLE users (
                    email VARCHAR(255) NOT NULL UNIQUE,
                    id VARCHAR(32) NOT NULL PRIMARY KEY,
                    password_hash VARCHAR(128) NOT NULL,
                    nickname VARCHAR(50) NOT NULL DEFAULT '',
                    avatar TEXT NOT NULL DEFAULT '',
                    role VARCHAR(10) NOT NULL DEFAULT 'user',
                    plan VARCHAR(20) NOT NULL DEFAULT 'free',
                    plan_expires_at DATETIME,
                    token_version INTEGER NOT NULL DEFAULT 0,
                    reset_code VARCHAR(10) NOT NULL DEFAULT '',
                    reset_code_expires_at DATETIME,
                    org_id VARCHAR(32) NOT NULL DEFAULT '',
                    org_role VARCHAR(10) NOT NULL DEFAULT '',
                    org_monthly_limit INTEGER NOT NULL DEFAULT -1,
                    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
                )
            """)
            conn.exec_driver_sql("CREATE INDEX custom_users_nickname ON users(nickname)")
            conn.exec_driver_sql("""
                CREATE TRIGGER custom_users_upper_nickname AFTER INSERT ON users
                BEGIN
                    UPDATE users SET nickname = upper(new.nickname) WHERE id = new.id;
                END
            """)
            conn.exec_driver_sql("""
                INSERT INTO users (email, id, password_hash, nickname)
                VALUES ('before@example.com', 'u1', 'hash', 'before')
            """)

            _fix_column_order_if_needed(conn)

            columns = conn.exec_driver_sql("PRAGMA table_info(users)").fetchall()
            self.assertEqual("id", columns[0][1])
            self.assertEqual("email", columns[1][1])
            self.assertEqual("VARCHAR(44)", next(row[2] for row in columns if row[1] == "reset_code"))
            self.assertEqual(1, next(row[5] for row in columns if row[1] == "id"))
            self.assertEqual(1, next(row[3] for row in columns if row[1] == "password_hash"))
            self.assertEqual("'free'", next(row[4] for row in columns if row[1] == "plan"))

            schema_objects = {
                (row[0], row[1])
                for row in conn.exec_driver_sql("""
                    SELECT type, name FROM sqlite_master
                    WHERE tbl_name='users' AND type IN ('index', 'trigger')
                """)
            }
            self.assertIn(("index", "custom_users_nickname"), schema_objects)
            self.assertIn(("trigger", "custom_users_upper_nickname"), schema_objects)
            self.assertIn(("index", "sqlite_autoindex_users_1"), schema_objects)

            self.assertEqual(
                ("u1", "before@example.com", "BEFORE"),
                conn.exec_driver_sql("SELECT id, email, nickname FROM users").one(),
            )
            with self.assertRaises(Exception):
                conn.exec_driver_sql("""
                    INSERT INTO users (email, id, password_hash, nickname)
                    VALUES ('before@example.com', 'u2', 'hash', 'duplicate')
                """)
            conn.rollback()

    def test_type_mismatch_rebuilds_even_when_column_order_matches(self) -> None:
        with self.engine.connect() as conn:
            conn.exec_driver_sql("PRAGMA foreign_keys=OFF")
            conn.exec_driver_sql("BEGIN IMMEDIATE")
            conn.exec_driver_sql("""
                CREATE TABLE service_keys (
                    id VARCHAR(32) NOT NULL PRIMARY KEY,
                    service VARCHAR(10) NOT NULL,
                    encrypted_value TEXT NOT NULL,
                    label VARCHAR(100) NOT NULL DEFAULT '',
                    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
                )
            """)
            conn.exec_driver_sql("""
                INSERT INTO service_keys
                VALUES ('k1', 'llm', 'encrypted', 'main', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            """)

            _fix_column_order_if_needed(conn)

            columns = conn.exec_driver_sql("PRAGMA table_info(service_keys)").fetchall()
            self.assertEqual("VARCHAR(50)", next(row[2] for row in columns if row[1] == "service"))
            self.assertEqual("encrypted", conn.exec_driver_sql(
                "SELECT encrypted_value FROM service_keys WHERE id='k1'"
            ).scalar_one())
            conn.rollback()

    def test_failure_can_be_rolled_back_without_losing_original_table(self) -> None:
        with self.engine.connect() as conn:
            conn.exec_driver_sql("PRAGMA foreign_keys=OFF")
            conn.exec_driver_sql("BEGIN IMMEDIATE")
            # id 的 NULL 无法复制到 ORM 模型中的 NOT NULL 主键，应中止迁移。
            conn.exec_driver_sql("""
                CREATE TABLE service_keys (
                    id VARCHAR(32), service VARCHAR(10), encrypted_value TEXT,
                    label VARCHAR(100), created_at DATETIME, updated_at DATETIME
                )
            """)
            conn.exec_driver_sql("""
                INSERT INTO service_keys VALUES
                (NULL, 'llm', 'must-survive', '', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            """)
            # 现有表/数据代表迁移前已持久化的数据库状态。
            conn.commit()
            conn.exec_driver_sql("BEGIN IMMEDIATE")

            with self.assertRaises(Exception):
                _fix_column_order_if_needed(conn)
            conn.rollback()

            self.assertEqual(
                (None, "must-survive"),
                conn.exec_driver_sql("SELECT id, encrypted_value FROM service_keys").one(),
            )
            self.assertIsNone(conn.exec_driver_sql(
                "SELECT name FROM sqlite_master WHERE type='table' "
                "AND name='__migration_new_service_keys'"
            ).first())


if __name__ == "__main__":
    unittest.main()
