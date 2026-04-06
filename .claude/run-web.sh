#!/bin/sh
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
exec pnpm --filter "@cribliv/web" dev
