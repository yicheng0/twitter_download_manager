import runpy
import sys


if __name__ == '__main__':
    runpy.run_module('backend.crawler.reply_down', run_name='__main__')
else:
    from backend.crawler import reply_down as _module

    sys.modules[__name__] = _module
