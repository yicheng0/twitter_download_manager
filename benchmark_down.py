import asyncio
import csv
import hashlib
import json
import os
import re
import time
from datetime import datetime, timedelta
from urllib.parse import urlparse

import httpx

from proxy_utils import proxy_for_httpx
from url_utils import quote_url


AUTHORIZATION = 'Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA'


def parse_screen_name(value):
    text = str(value or '').strip()
    if not text:
        return ''
    text = text.splitlines()[0].strip()
    if text.startswith('@'):
        text = text[1:]
    if text.lower().startswith(('x.com/', 'twitter.com/', 'www.x.com/', 'www.twitter.com/')):
        text = 'https://' + text
    if '://' in text:
        parsed = urlparse(text)
        parts = [part for part in parsed.path.split('/') if part]
        if not parts:
            return ''
        text = parts[0]
    else:
        text = text.split('?', 1)[0].strip('/')
        if '/' in text:
            return ''
    if text.startswith('@'):
        text = text[1:]
    if not re.match(r'^[A-Za-z0-9_]{1,15}$', text):
        return ''
    return text


def stamp2time(msecs_stamp):
    time_array = time.localtime(msecs_stamp / 1000)
    return time.strftime('%Y-%m-%d %H:%M', time_array)


def time2stamp(timestr):
    datetime_obj = datetime.strptime(timestr, '%Y-%m-%d')
    return int(time.mktime(datetime_obj.timetuple()) * 1000.0 + datetime_obj.microsecond / 1000.0)


def default_time_range(days=365):
    end = datetime.now()
    start = end - timedelta(days=days - 1)
    return f'{start.strftime("%Y-%m-%d")}:{end.strftime("%Y-%m-%d")}'


def del_special_char(value):
    return re.sub(r'[^\u4e00-\u9fa5\u0030-\u0039\u0041-\u005a\u0061-\u007a\u3040-\u31FF\.]', '', str(value or ''))


def hash_save_token(media_url):
    digest = hashlib.md5()
    digest.update(f'{media_url}'.encode('utf-8'))
    return digest.hexdigest()[:4]


def get_heighest_video_quality(variants):
    if len(variants) == 1:
        return variants[0]['url']
    max_bitrate = 0
    highest_url = None
    for item in variants:
        if 'bitrate' in item and int(item['bitrate']) > max_bitrate:
            max_bitrate = int(item['bitrate'])
            highest_url = item['url']
    return highest_url


class BenchmarkCsv:
    def __init__(self, save_path, display_name, screen_name, tweet_range):
        self.f = open(
            f'{save_path}/{screen_name}-{datetime.now().strftime("%Y-%m-%d_%H-%M-%S")}-benchmark.csv',
            'w',
            encoding='utf-8-sig',
            newline='',
        )
        self.writer = csv.writer(self.f)
        self.writer.writerow([display_name, '@' + screen_name])
        self.writer.writerow(['Tweet Range : ' + tweet_range])
        self.writer.writerow(['Save Path : ' + save_path])
        self.writer.writerow(
            [
                'Tweet Date',
                'Display Name',
                'User Name',
                'Tweet URL',
                'Media Type',
                'Media URL',
                'Saved Filename',
                'Tweet Content',
                'Favorite Count',
                'Retweet Count',
                'Reply Count',
            ]
        )

    def data_input(self, row):
        row[0] = stamp2time(row[0])
        self.writer.writerow(row)

    def csv_close(self):
        self.f.close()


class BenchmarkAccountDownloader:
    def __init__(self, config, cookie, output_dir):
        self.config = config
        self.cookie = cookie
        self.output_dir = output_dir
        self.proxy = proxy_for_httpx(config.get('proxy'))
        self.tweet_limit = int(config.get('tweet_limit') or 50)
        self.has_video = bool(config.get('has_video', True))
        self.has_retweet = bool(config.get('has_retweet'))
        self.max_concurrent_requests = int(config.get('max_concurrent_requests') or 8)
        self.time_range = config.get('time_range') or default_time_range()
        start, end = self.time_range.split(':', 1)
        self.start_time_stamp = time2stamp(start)
        self.end_time_stamp = time2stamp(end)
        self.request_count = 0
        self.download_count = 0
        self.headers = {
            'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36',
            'authorization': AUTHORIZATION,
            'cookie': cookie,
            'x-csrf-token': re.findall(r'ct0=(.*?);', cookie)[0],
        }

    def get_user_info(self, screen_name):
        url = 'https://twitter.com/i/api/graphql/xc8f1g7BYqr6VTzTbvNlGw/UserByScreenName?variables={"screen_name":"' + screen_name + '","withSafetyModeUserFields":false}&features={"hidden_profile_likes_enabled":false,"hidden_profile_subscriptions_enabled":false,"responsive_web_graphql_exclude_directive_enabled":true,"verified_phone_label_enabled":false,"subscriptions_verification_info_verified_since_enabled":true,"highlights_tweets_tab_ui_enabled":true,"creator_subscriptions_tweet_preview_api_enabled":true,"responsive_web_graphql_skip_user_profile_image_extensions_enabled":false,"responsive_web_graphql_timeline_navigation_enabled":true}&fieldToggles={"withAuxiliaryUserLabels":false}'
        response = httpx.get(quote_url(url), headers=self.headers, proxy=self.proxy).text
        self.request_count += 1
        raw_data = json.loads(response)
        result = raw_data['data']['user']['result']
        legacy = result['legacy']
        return {
            'rest_id': result['rest_id'],
            'name': legacy['name'],
            'screen_name': legacy['screen_name'],
            'statuses_count': legacy['statuses_count'],
        }

    def tweet_url(self, user_id, cursor):
        url_top = 'https://twitter.com/i/api/graphql/2GIWTr7XwadIixZDtyXd4A/UserTweets?variables={"userId":"' + user_id + '","count":20,'
        url_bottom = '"includePromotedContent":false,"withQuickPromoteEligibilityTweetFields":true,"withVoice":true,"withV2Timeline":true}&features={"rweb_lists_timeline_redesign_enabled":true,"responsive_web_graphql_exclude_directive_enabled":true,"verified_phone_label_enabled":false,"creator_subscriptions_tweet_preview_api_enabled":true,"responsive_web_graphql_timeline_navigation_enabled":true,"responsive_web_graphql_skip_user_profile_image_extensions_enabled":false,"tweetypie_unmention_optimization_enabled":true,"responsive_web_edit_tweet_api_enabled":true,"graphql_is_translatable_rweb_tweet_is_translatable_enabled":true,"view_counts_everywhere_api_enabled":true,"longform_notetweets_consumption_enabled":true,"responsive_web_twitter_article_tweet_consumption_enabled":false,"tweet_awards_web_tipping_enabled":false,"freedom_of_speech_not_reach_fetch_enabled":true,"standardized_nudges_misinfo":true,"tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled":true,"longform_notetweets_rich_text_read_enabled":true,"longform_notetweets_inline_media_enabled":true,"responsive_web_media_download_video_enabled":false,"responsive_web_enhance_cards_enabled":false}&fieldToggles={"withAuxiliaryUserLabels":false,"withArticleRichContentState":false}'
        if cursor:
            return url_top + '"cursor":"' + cursor + '",' + url_bottom
        return url_top + url_bottom

    def unwrap_tweet(self, raw_tweet):
        if 'tweet' in raw_tweet:
            raw_tweet = raw_tweet['tweet']
        legacy = raw_tweet.get('legacy') or {}
        if 'retweeted_status_result' in legacy:
            if not self.has_retweet:
                return None
            raw_tweet = legacy['retweeted_status_result']['result']
            if 'tweet' in raw_tweet:
                raw_tweet = raw_tweet['tweet']
        return raw_tweet

    def tweet_timestamp(self, tweet):
        edit_control = tweet.get('edit_control') or {}
        try:
            return int(edit_control['editable_until_msecs']) - 3600000
        except Exception:
            initial = edit_control.get('edit_control_initial') or {}
            return int(initial['editable_until_msecs']) - 3600000

    def extract_tweet(self, item):
        if 'tweet' not in item.get('entryId', '') or 'promoted-tweet' in item.get('entryId', ''):
            return None
        content = item.get('content') or item.get('item') or {}
        item_content = content.get('itemContent') or {}
        raw_result = ((item_content.get('tweet_results') or {}).get('result') or {})
        tweet = self.unwrap_tweet(raw_result)
        if not tweet:
            return None
        legacy = tweet.get('legacy') or {}
        timestamp = self.tweet_timestamp(tweet)
        if timestamp < self.start_time_stamp:
            return {'too_old': True}
        if timestamp > self.end_time_stamp:
            return None
        user_legacy = tweet['core']['user_results']['result']['legacy']
        screen_name = user_legacy['screen_name']
        status_id = legacy.get('id_str') or legacy.get('conversation_id_str')
        if 'note_tweet' in tweet:
            content_text = tweet['note_tweet']['note_tweet_results']['result']['text']
        else:
            content_text = legacy.get('full_text') or ''
        return {
            'timestamp': timestamp,
            'display_name': user_legacy['name'],
            'screen_name': screen_name,
            'tweet_url': f'https://x.com/{screen_name}/status/{status_id}',
            'content': content_text.split('https://t.co/')[0],
            'favorite_count': legacy.get('favorite_count', 0),
            'retweet_count': legacy.get('retweet_count', 0),
            'reply_count': legacy.get('reply_count', 0),
            'media': legacy.get('extended_entities', {}).get('media') or [],
        }

    def extract_entries(self, raw_data, cursor):
        instructions = raw_data['data']['user']['result']['timeline_v2']['timeline']['instructions']
        entries = instructions[-1].get('entries') or []
        if not cursor:
            for instruction in instructions:
                if instruction.get('type') == 'TimelineAddEntries':
                    entries = instruction.get('entries') or entries
                    break
        next_cursor = cursor
        items = []
        for entry in entries:
            entry_id = entry.get('entryId', '')
            if 'cursor-bottom' in entry_id:
                next_cursor = entry['content']['value']
            elif 'tweet' in entry_id:
                items.append(entry)
            elif 'profile-conversation' in entry_id:
                for sub_item in entry.get('content', {}).get('items', []):
                    items.append(sub_item.get('item') or sub_item)
        return items, next_cursor

    async def download_media(self, media_jobs):
        semaphore = asyncio.Semaphore(self.max_concurrent_requests)

        async def down_save(url, file_path):
            attempts = 0
            while True:
                try:
                    async with semaphore:
                        async with httpx.AsyncClient(proxy=self.proxy) as client:
                            response = await client.get(quote_url(url), timeout=(3.05, 16))
                            response.raise_for_status()
                    with open(file_path, 'wb') as f:
                        f.write(response.content)
                    self.download_count += 1
                    return
                except Exception as exc:
                    attempts += 1
                    if attempts >= 10:
                        print(f'{file_path} 下载失败，已跳过: {exc}', flush=True)
                        return
                    print(f'{file_path} 第{attempts}次下载失败，正在重试', flush=True)

        await asyncio.gather(*[asyncio.create_task(down_save(url, file_path)) for url, file_path in media_jobs])

    def media_rows(self, tweet, folder_path):
        rows = []
        media_jobs = []
        for index, media in enumerate(tweet['media']):
            is_video = 'video_info' in media
            if is_video and not self.has_video:
                continue
            media_url = get_heighest_video_quality(media['video_info']['variants']) if is_video else media['media_url_https'] + '?name=orig'
            media_type = 'Video' if is_video else 'Image'
            extension = 'mp4' if is_video else (media['media_url_https'].split('.')[-1] or 'jpg')
            file_name = f'{stamp2time(tweet["timestamp"]).replace(":", "-")}_{hash_save_token(media_url)}_{index}.{extension}'
            file_path = os.path.join(folder_path, file_name)
            rows.append(
                [
                    tweet['timestamp'],
                    tweet['display_name'],
                    '@' + tweet['screen_name'],
                    tweet['tweet_url'],
                    media_type,
                    media_url,
                    file_name,
                    tweet['content'],
                    tweet['favorite_count'],
                    tweet['retweet_count'],
                    tweet['reply_count'],
                ]
            )
            media_jobs.append((media_url, file_path))
        if not rows:
            rows.append(
                [
                    tweet['timestamp'],
                    tweet['display_name'],
                    '@' + tweet['screen_name'],
                    tweet['tweet_url'],
                    '',
                    '',
                    '',
                    tweet['content'],
                    tweet['favorite_count'],
                    tweet['retweet_count'],
                    tweet['reply_count'],
                ]
            )
        return rows, media_jobs

    def run_user(self, screen_name):
        self.headers['referer'] = 'https://twitter.com/' + screen_name
        user = self.get_user_info(screen_name)
        folder_path = os.path.join(self.output_dir, del_special_char(user['screen_name']))
        os.makedirs(folder_path, exist_ok=True)
        print(f'开始对标账号采集: @{user["screen_name"]}，最多 {self.tweet_limit} 条推文', flush=True)

        csv_file = BenchmarkCsv(folder_path, user['name'], user['screen_name'], self.time_range)
        cursor = ''
        saved_tweets = 0
        all_media_jobs = []
        seen_tweets = set()
        try:
            while saved_tweets < self.tweet_limit:
                url = self.tweet_url(user['rest_id'], cursor)
                response = httpx.get(quote_url(url), headers=self.headers, proxy=self.proxy).text
                self.request_count += 1
                raw_data = json.loads(response)
                entries, next_cursor = self.extract_entries(raw_data, cursor)
                if not entries or next_cursor == cursor:
                    break
                stop_for_time = False
                for item in entries:
                    if saved_tweets >= self.tweet_limit:
                        break
                    tweet = self.extract_tweet(item)
                    if not tweet:
                        continue
                    if tweet.get('too_old'):
                        stop_for_time = True
                        break
                    if tweet['tweet_url'] in seen_tweets:
                        continue
                    seen_tweets.add(tweet['tweet_url'])
                    rows, media_jobs = self.media_rows(tweet, folder_path)
                    for row in rows:
                        csv_file.data_input(row)
                    all_media_jobs.extend(media_jobs)
                    saved_tweets += 1
                cursor = next_cursor
                if stop_for_time:
                    break
        finally:
            csv_file.csv_close()

        if all_media_jobs:
            asyncio.run(self.download_media(all_media_jobs))
        print(f'@{user["screen_name"]} 采集完成: {saved_tweets} 条推文，{len(all_media_jobs)} 个媒体任务', flush=True)

    def run(self):
        targets = [parse_screen_name(item) for item in str(self.config.get('targets') or '').replace(',', '\n').splitlines()]
        users = [item for item in targets if item]
        if not users:
            raise RuntimeError('At least one benchmark account URL or user name is required.')
        started = time.time()
        for user in users:
            self.run_user(user)
        print(f'对标账号任务完成, 耗时 {time.time() - started:.2f} 秒, API 调用 {self.request_count} 次, 下载 {self.download_count} 份文件', flush=True)


def run_benchmark_account(config, cookie, output_dir):
    BenchmarkAccountDownloader(config, cookie, output_dir).run()
