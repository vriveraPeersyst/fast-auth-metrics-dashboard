#!/usr/bin/env bash
set -euo pipefail
# One-line statusline: [Model] progress_bar context% | $cost | duration | cache% | API usage
# Dependencies: jq, curl

stdin_data=$(cat)

# --- API Usage fetching with caching ---
USAGE_CACHE="${TMPDIR:-/tmp}/claude-usage-cache.json"
USAGE_CACHE_TTL=300  # 5 minutes

fetch_api_usage() {
    local creds_file="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/.credentials.json"
    [ -f "$creds_file" ] || return 1

    local token
    token=$(jq -r '.claudeAiOauth.accessToken // empty' "$creds_file" 2>/dev/null)
    [ -n "$token" ] || return 1

    local response
    response=$(curl -s --max-time 3 \
        -H "Authorization: Bearer $token" \
        -H "anthropic-beta: oauth-2025-04-20" \
        "https://api.anthropic.com/api/oauth/usage" 2>/dev/null)

    [ -n "$response" ] && echo "$response" > "$USAGE_CACHE"
}

load_api_usage() {
    # Check cache freshness
    if [ -f "$USAGE_CACHE" ]; then
        local cache_age=$(($(date +%s) - $(stat -c %Y "$USAGE_CACHE" 2>/dev/null || stat -f %m "$USAGE_CACHE" 2>/dev/null || echo 0)))
        [ "$cache_age" -gt "$USAGE_CACHE_TTL" ] && fetch_api_usage
    else
        fetch_api_usage
    fi

    [ -f "$USAGE_CACHE" ] || return 1

    local usage_data
    usage_data=$(cat "$USAGE_CACHE")

    five_hr=$(echo "$usage_data" | jq -r '.five_hour.utilization // empty' 2>/dev/null)
    local five_reset=$(echo "$usage_data" | jq -r '.five_hour.resets_at // empty' 2>/dev/null)
    seven_day=$(echo "$usage_data" | jq -r '.seven_day.utilization // empty' 2>/dev/null)
    local seven_reset=$(echo "$usage_data" | jq -r '.seven_day.resets_at // empty' 2>/dev/null)

    [ -n "$five_hr" ] || return 1

    # Calculate time until reset
    local now five_reset_ts seven_reset_ts
    now=$(date +%s)

    # Parse ISO date (works on both GNU and BSD date)
    if date --version >/dev/null 2>&1; then
        five_reset_ts=$(date -d "$five_reset" +%s 2>/dev/null || echo "$now")
        seven_reset_ts=$(date -d "$seven_reset" +%s 2>/dev/null || echo "$now")
    else
        five_reset_ts=$(date -j -f "%Y-%m-%dT%H:%M:%S" "${five_reset%%.*}" +%s 2>/dev/null || echo "$now")
        seven_reset_ts=$(date -j -f "%Y-%m-%dT%H:%M:%S" "${seven_reset%%.*}" +%s 2>/dev/null || echo "$now")
    fi

    # Format time remaining
    local five_secs=$((five_reset_ts - now))
    local seven_secs=$((seven_reset_ts - now))

    if [ "$five_secs" -gt 3600 ]; then
        five_remaining="$((five_secs / 3600))h"
    elif [ "$five_secs" -gt 0 ]; then
        five_remaining="$((five_secs / 60))m"
    else
        five_remaining="0m"
    fi

    if [ "$seven_secs" -gt 86400 ]; then
        seven_remaining="$((seven_secs / 86400))d$((seven_secs % 86400 / 3600))h"
    elif [ "$seven_secs" -gt 3600 ]; then
        seven_remaining="$((seven_secs / 3600))h"
    else
        seven_remaining="0h"
    fi
}

# Build a mini progress bar (10 chars wide, min 1 block if > 0%)
make_mini_bar() {
    local pct=$1 width=10
    local filled=$((pct * width / 100))
    # Show at least 1 block if there's any usage
    [ "$pct" -gt 0 ] && [ "$filled" -eq 0 ] && filled=1
    local empty=$((width - filled))
    local bar_color

    if [ "$pct" -lt 50 ]; then bar_color='\033[32m'
    elif [ "$pct" -lt 80 ]; then bar_color='\033[33m'
    else bar_color='\033[31m'; fi

    local bar="${bar_color}"
    for ((i=0; i<filled; i++)); do bar="${bar}█"; done
    bar="${bar}\033[2m"
    for ((i=0; i<empty; i++)); do bar="${bar}░"; done
    bar="${bar}\033[0m"
    printf '%b' "$bar"
}

# Load API usage data
five_hr="" seven_day="" five_remaining="" seven_remaining=""
load_api_usage 2>/dev/null || true

IFS=$'\t' read -r model_name cost duration_ms ctx_used cache_pct < <(
    echo "$stdin_data" | jq -r '[
        .model.display_name // "Unknown",
        (try (.cost.total_cost_usd // 0 | . * 100 | floor / 100) catch 0),
        (.cost.total_duration_ms // 0),
        (try (
            if (.context_window.remaining_percentage // null) != null then
                100 - (.context_window.remaining_percentage | floor)
            elif (.context_window.context_window_size // 0) > 0 then
                (((.context_window.current_usage.input_tokens // 0) +
                  (.context_window.current_usage.cache_creation_input_tokens // 0) +
                  (.context_window.current_usage.cache_read_input_tokens // 0)) * 100 /
                 .context_window.context_window_size) | floor
            else "null" end
        ) catch "null"),
        (try (
            (.context_window.current_usage // {}) |
            if (.input_tokens // 0) + (.cache_creation_input_tokens // 0) + (.cache_read_input_tokens // 0) > 0 then
                ((.cache_read_input_tokens // 0) * 100 /
                 ((.input_tokens // 0) + (.cache_creation_input_tokens // 0) + (.cache_read_input_tokens // 0))) | floor
            else 0 end
        ) catch 0)
    ] | @tsv'
) || true

# Fallback if jq failed
if [ -z "$model_name" ]; then
    model_name=$(echo "$stdin_data" | jq -r '.model.display_name // "Unknown"' 2>/dev/null)
    cost=$(echo "$stdin_data" | jq -r '(.cost.total_cost_usd // 0)' 2>/dev/null)
    duration_ms=$(echo "$stdin_data" | jq -r '(.cost.total_duration_ms // 0)' 2>/dev/null)
    ctx_used="" cache_pct="0"
    : "${model_name:=Unknown}" "${cost:=0}" "${duration_ms:=0}"
fi

# Short model name
short_model=$(echo "$model_name" | sed -E 's/^Claude ([0-9.]+) /\1 /; s/^Claude //')

# Progress bar
SEP='\033[2m|\033[0m'
progress_bar=""
ctx_pct=""
bar_width=12

if [ -n "$ctx_used" ] && [ "$ctx_used" != "null" ] && [ "$ctx_used" -eq "$ctx_used" ] 2>/dev/null; then
    filled=$((ctx_used * bar_width / 100))
    empty=$((bar_width - filled))

    if [ "$ctx_used" -lt 50 ]; then bar_color='\033[32m'
    elif [ "$ctx_used" -lt 80 ]; then bar_color='\033[33m'
    else bar_color='\033[31m'; fi

    progress_bar="${bar_color}"
    for ((i=0; i<filled; i++)); do progress_bar="${progress_bar}█"; done
    progress_bar="${progress_bar}\033[2m"
    for ((i=0; i<empty; i++)); do progress_bar="${progress_bar}⣿"; done
    progress_bar="${progress_bar}\033[0m"
    ctx_pct="${ctx_used}%"
fi

# Duration
session_time=""
if [ "$duration_ms" -gt 0 ] 2>/dev/null; then
    total_sec=$((duration_ms / 1000))
    hours=$((total_sec / 3600))
    minutes=$(((total_sec % 3600) / 60))
    seconds=$((total_sec % 60))
    if [ "$hours" -gt 0 ]; then session_time="${hours}h ${minutes}m"
    elif [ "$minutes" -gt 0 ]; then session_time="${minutes}m ${seconds}s"
    else session_time="${seconds}s"; fi
fi

# Build single line
line=$(printf '\033[37m🤖 [%s]\033[0m' "$short_model")

if [ -n "$progress_bar" ]; then
    line="$line $(printf '%b' "$progress_bar")"
fi
if [ -n "$ctx_pct" ]; then
    line="$line $(printf '\033[37m%s\033[0m' "$ctx_pct")"
fi
line="$line $(printf '%b \033[33m💰 $%s\033[0m' "$SEP" "$cost")"
if [ -n "$session_time" ]; then
    line="$line $(printf '%b \033[36m⏳ %s\033[0m' "$SEP" "$session_time")"
fi
if [ "$cache_pct" -gt 0 ] 2>/dev/null; then
    line="$line $(printf '%b \033[2m🔄 %s%%\033[0m' "$SEP" "$cache_pct")"
fi

# Build line 2: API usage with progress bars
line2=""
if [ -n "$five_hr" ] && [ -n "$seven_day" ]; then
    five_hr_int=${five_hr%.*}
    seven_day_int=${seven_day%.*}
    five_bar=$(make_mini_bar "$five_hr_int")
    seven_bar=$(make_mini_bar "$seven_day_int")
    line2=$(printf '\033[35m⚡ 5h:\033[0m %b \033[37m%d%% %s\033[0m %b \033[35m7d:\033[0m %b \033[37m%d%% %s\033[0m' \
        "$five_bar" "$five_hr_int" "$five_remaining" "$SEP" "$seven_bar" "$seven_day_int" "$seven_remaining")
fi

if [ -n "$line2" ]; then
    printf '%b\n%b' "$line" "$line2"
else
    printf '%b' "$line"
fi
