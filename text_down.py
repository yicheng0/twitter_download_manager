import runpy
import sys


if __name__ == '__main__':
    runpy.run_module('backend.crawler.text_down', run_name='__main__')
else:
    from backend.crawler import text_down as _module

    sys.modules[__name__] = _module
