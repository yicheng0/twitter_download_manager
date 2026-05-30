import runpy
import sys


if __name__ == '__main__':
    runpy.run_module('backend.crawler.runtime.user_agent_pool', run_name='__main__')
else:
    from backend.crawler.runtime import user_agent_pool as _module

    sys.modules[__name__] = _module
