import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ExternalLink, Image as ImageIcon, Video } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader } from '../components/ui/card';

export function TaskLiveView() {
  const { id } = useParams<{ id: string }>();
  const taskId = parseInt(id || '0', 10);
  const navigate = useNavigate();

  // 获取任务信息
  const { data: taskData } = useQuery({
    queryKey: ['task', taskId],
    queryFn: () => api.task(taskId),
    refetchInterval: 5000,
  });

  // 获取实时数据流（每 3 秒刷新）
  const { data: streamData, isLoading } = useQuery({
    queryKey: ['task-items-stream', taskId],
    queryFn: () => api.taskItemsStream(taskId, { offset: 0, limit: 100 }),
    refetchInterval: 3000,
  });

  const task = taskData?.task;
  const items = streamData?.items || [];
  const total = streamData?.total || 0;

  // 统计数据
  const imageCount = items.filter(item => item.media_type === 'photo').length;
  const videoCount = items.filter(item => item.media_type === 'video' || item.media_type === 'animated_gif').length;
  const totalInteractions = items.reduce((sum, item) => sum + item.favorite_count + item.retweet_count + item.reply_count, 0);

  return (
    <div className="p-6 space-y-6">
      {/* 头部 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" onClick={() => navigate(`/tasks/${taskId}`)}>
            <ArrowLeft className="w-4 h-4 mr-2" />
            返回任务详情
          </Button>
          <div>
            <h1 className="text-2xl font-bold">实时数据流</h1>
            {task && <p className="text-sm text-muted-foreground">{task.title}</p>}
          </div>
        </div>
        {task?.status === 'running' && (
          <div className="flex items-center gap-2 text-sm text-green-600">
            <div className="w-2 h-2 bg-green-600 rounded-full animate-pulse" />
            采集中...
          </div>
        )}
      </div>

      {/* 统计卡片 */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <div className="text-sm text-muted-foreground">总推文数</div>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{total}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <div className="text-sm text-muted-foreground flex items-center gap-1">
              <ImageIcon className="w-4 h-4" />
              图片数
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{imageCount}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <div className="text-sm text-muted-foreground flex items-center gap-1">
              <Video className="w-4 h-4" />
              视频数
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{videoCount}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <div className="text-sm text-muted-foreground">总互动数</div>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{totalInteractions.toLocaleString()}</div>
          </CardContent>
        </Card>
      </div>

      {/* 数据表格 */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">采集数据</h2>
            <div className="text-sm text-muted-foreground">
              显示最新 {items.length} 条，共 {total} 条
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading && items.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">加载中...</div>
          ) : items.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">暂无数据</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b">
                  <tr className="text-left">
                    <th className="pb-2 font-medium">时间</th>
                    <th className="pb-2 font-medium">用户</th>
                    <th className="pb-2 font-medium">内容</th>
                    <th className="pb-2 font-medium">媒体</th>
                    <th className="pb-2 font-medium text-right">互动</th>
                    <th className="pb-2 font-medium">链接</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.id} className="border-b hover:bg-muted/50">
                      <td className="py-3 text-muted-foreground whitespace-nowrap">
                        {item.tweet_date}
                      </td>
                      <td className="py-3">
                        <div>
                          <div className="font-medium">{item.display_name}</div>
                          <div className="text-xs text-muted-foreground">@{item.user_name}</div>
                        </div>
                      </td>
                      <td className="py-3 max-w-md">
                        <div className="line-clamp-2">{item.tweet_content}</div>
                      </td>
                      <td className="py-3">
                        {item.media_type && (
                          <div className="flex items-center gap-1 text-xs">
                            {item.media_type === 'photo' && <ImageIcon className="w-3 h-3" />}
                            {(item.media_type === 'video' || item.media_type === 'animated_gif') && <Video className="w-3 h-3" />}
                            {item.media_type}
                          </div>
                        )}
                      </td>
                      <td className="py-3 text-right">
                        <div className="text-xs space-y-1">
                          <div>❤️ {item.favorite_count}</div>
                          <div>🔁 {item.retweet_count}</div>
                          <div>💬 {item.reply_count}</div>
                        </div>
                      </td>
                      <td className="py-3">
                        {item.tweet_url && (
                          <a
                            href={item.tweet_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-blue-600 hover:underline"
                          >
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

