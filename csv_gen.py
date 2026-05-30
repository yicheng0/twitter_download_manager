import csv
import os
import sqlite3
import time
from datetime import datetime


def _env_task_id():
    """从环境变量读取任务 ID（由 web_runner 注入）"""
    value = os.environ.get('TW_TASK_ID', '').strip()
    if value:
        try:
            return int(value)
        except ValueError:
            return None
    return None


def _env_db_path():
    """从环境变量读取数据库路径（由 web_runner 注入）"""
    value = os.environ.get('TW_REALTIME_DB_PATH', '').strip()
    return value or None


class RealtimeWriter:
    """
    实时数据写入器（批量模式）

    将采集到的推文数据批量写入 task_items_realtime 表，供前端实时展示。
    task_id / db_path 优先使用参数，否则从环境变量读取（由 web_runner 注入）。
    传入的 row 需为已转换好的列表，且第一个元素 tweet_date 已是字符串。
    """

    def __init__(self, task_id=None, db_path=None, batch_size=10):
        self.task_id = task_id if task_id is not None else _env_task_id()
        self.db_path = db_path if db_path is not None else _env_db_path()
        self.batch_size = batch_size
        self.batch = []

    @property
    def enabled(self):
        return bool(self.task_id and self.db_path)

    def add(self, row):
        """添加一行数据到缓冲区（row[0] 需为已格式化的时间字符串）"""
        if not self.enabled:
            return
        try:
            self.batch.append(list(row))
            if len(self.batch) >= self.batch_size:
                self.flush()
        except Exception as e:
            print(f'[警告] 添加到实时数据缓冲区失败: {e}')

    def flush(self):
        """刷新缓冲区到数据库"""
        if not self.enabled or not self.batch:
            return
        try:
            conn = sqlite3.connect(self.db_path, timeout=10)
            cursor = conn.cursor()
            for row in self.batch:
                # 补齐到 11 列，避免索引越界
                padded = (list(row) + [''] * 11)[:11]
                cursor.execute('''
                    INSERT OR IGNORE INTO task_items_realtime
                    (task_id, tweet_date, display_name, user_name, tweet_url, media_type,
                     media_url, saved_filename, tweet_content, favorite_count, retweet_count,
                     reply_count, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ''', (
                    self.task_id,
                    padded[0],   # tweet_date (字符串)
                    padded[1],   # display_name
                    padded[2],   # user_name
                    padded[3],   # tweet_url
                    padded[4],   # media_type
                    padded[5],   # media_url
                    padded[6],   # saved_filename
                    padded[7],   # tweet_content
                    padded[8],   # favorite_count
                    padded[9],   # retweet_count
                    padded[10],  # reply_count
                    datetime.now().isoformat(),
                ))
            conn.commit()
            conn.close()
            self.batch = []
        except Exception as e:
            print(f'[警告] 批量写入实时数据库失败: {e}')
            # 失败时也清空缓冲区，避免内存积累
            self.batch = []


class csv_gen():
    def __init__(self, save_path: str, user_name, screen_name, tweet_range, task_id=None, db_path=None) -> None:
        self.f = open(f'{save_path}/{screen_name}-{datetime.now().strftime("%Y-%m-%d_%H-%M-%S")}.csv', 'w', encoding='utf-8-sig', newline='')
        self.writer = csv.writer(self.f)
        self.realtime = RealtimeWriter(task_id=task_id, db_path=db_path)

        # 初始化
        self.writer.writerow([user_name, screen_name])
        self.writer.writerow(['Tweet Range : ' + tweet_range])
        self.writer.writerow(['Save Path : ' + save_path])
        main_par = ['Tweet Date', 'Display Name', 'User Name', 'Tweet URL', 'Media Type', 'Media URL', 'Saved Filename', 'Tweet Content', 'Favorite Count',
                    'Retweet Count', 'Reply Count']
        self.writer.writerow(main_par)

    def csv_close(self):
        # 关闭前刷新剩余的实时数据
        self.realtime.flush()
        self.f.close()

    def stamp2time(self, msecs_stamp: int) -> str:
        timeArray = time.localtime(msecs_stamp / 1000)
        otherStyleTime = time.strftime("%Y-%m-%d %H:%M", timeArray)
        return otherStyleTime

    def data_input(self, main_par_info: list) -> None:  # 数据格式参见 main_par
        main_par_info[0] = self.stamp2time(main_par_info[0])  # 传进来的是 int 时间戳, 故转换一下
        self.writer.writerow(main_par_info)

        # 同时写入实时数据库（实时数据展示）
        self.realtime.add(main_par_info)
