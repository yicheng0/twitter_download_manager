import sys

from backend.crawler.output import md_gen as _module

sys.modules[__name__] = _module
