#!/usr/bin/env bash
# 依頼のたびに現在時刻（日本時間）を Claude に渡す。tzdata がない環境（Git Bash など）でも動くよう JST-9 を使う。
TZ=JST-9 date '+Current time: %Y-%m-%d %H:%M:%S JST (%a)'
