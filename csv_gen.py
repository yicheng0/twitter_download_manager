import csv
import sqlite3
import time
from datetime import datetime


class csv_gen():
    def __init__(self, save_path: str, user_name, screen_name, tweet_range, task_id=None, db_path=None) -> None:
        self.f = open(f'{save_path}/{screen_name}-{datetime.now().strftime("%Y-%m-%d_%H-%M-%S")}.csv', 'w', encoding='utf-8-sig', newline='')
        self.writer = csv.writer(self.f)
        self.task_id = task_id  # 新增：任务 ID
        self.db_path = db_path  # 新增：数据库路径
        self.db_batch = []  # 新增：批量写入缓冲区
        self.db_batch_size = 10  # 新增：批量写入大小

        # 初始化
        self.writer.writerow([user_name, screen_name])
        self.writer.writerow(['Tweet Range : ' + tweet_range])
        self.writer.writerow(['Save Path : ' + save_path])
        main_par = ['Tweet Date', 'Display Name', 'User Name', 'Tweet URL', 'Media Type', 'Media URL', 'Saved Filename', 'Tweet Content', 'Favorite Count',
                    'Retweet Count', 'Reply Count']
        self.writer.writerow(main_par)

    def csv_close(self):
        # 关闭前刷新剩余的批量数据
        if self.db_batch:
            self._flush_db_batch()
        self.f.close()

    def stamp2time(self, msecs_stamp: int) -> str:
        timeArray = time.localtime(msecs_stamp / 1000)
        otherStyleTime = time.strftime("%Y-%m-%d %H:%M", timeArray)
        return otherStyleTime

    def data_input(self, main_par_info: list) -> None:  # 数据格式参见 main_par
        main_par_info[0] = self.stamp2time(main_par_info[0])  # 传进来的是 int 时间戳, 故转换一下
        self.writer.writerow(main_par_info)

        # 新增：同时写入数据库（实时数据展示）
        if self.task_id and self.db_path:
            self._write_to_db(main_par_info)

    def _write_to_db(self, row):
        """将数据写入实时数据库（批量模式）"""
        try:
            # 添加到批量缓冲区
            self.db_batch.append(row)

            # 达到批量大小时刷新
            if len(self.db_batch) >= self.db_batch_size:
                self._flush_db_batch()
        except Exception as e:
            print(f'[警告] 添加到实时数据批量缓冲区失败: {e}')

    def _flush_db_batch(self):
        """刷新批量缓冲区到数据库"""
        if not self.db_batch:
            return

        try:
            conn = sqlite3.connect(self.db_path, timeout=10)
            cursor = conn.cursor()

            # 批量插入
            for row in self.db_batch:
                cursor.execute('''
                    INSERT OR IGNORE INTO task_items_realtime
                    (task_id, tweet_date, display_name, user_name, tweet_url, media_type,
                     media_url, saved_filename, tweet_content, favorite_count, retweet_count,
                     reply_count, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ''', (
                    self.task_id,
                    row[0],  # tweet_date (已转换为字符串)
                    row[1],  # display_name
                    row[2],  # user_name
                    row[3],  # tweet_url
                    row[4],  # media_type
                    row[5],  # media_url
                    row[6],  # saved_filename
                    row[7],  # tweet_content
                    row[8],  # favorite_count
                    row[9],  # retweet_count
                    row[10],  # reply_count
                    datetime.now().isoformat()
                ))

            conn.commit()
            conn.close()

            # 清空缓冲区
            self.db_batch = []
        except Exception as e:
            print(f'[警告] 批量写入实时数据库失败: {e}')
            # 失败时也清空缓冲区，避免内存积累
            self.db_batch = []
