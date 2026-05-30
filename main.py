import runpy
import sys


if __name__ == '__main__':
    runpy.run_module('backend.crawler.main', run_name='__main__')
else:
    from backend.crawler import main as _module

    sys.modules[__name__] = _module
