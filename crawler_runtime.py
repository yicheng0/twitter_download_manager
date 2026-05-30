import sys

from backend.crawler.runtime import crawler_runtime as _module

sys.modules[__name__] = _module
