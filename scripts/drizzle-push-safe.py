#!/usr/bin/env python3
"""Run drizzle-kit push non-interactively without approving data loss."""

from __future__ import annotations

import os
import pty
import re
import select
import signal
import sys
import time


COMMAND = ["./node_modules/.bin/drizzle-kit", "push"]
TIMEOUT_SECONDS = 90
ANSI_ESCAPE = re.compile(r"\x1b(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])")
SAFE_PROMPT = "Do you want to truncate"
SAFE_OPTION = "No, add the constraint without truncating the table"
UNSAFE_PROMPT = "Do you still want to push changes?"


def main() -> int:
    pid, fd = pty.fork()
    if pid == 0:
        os.execvp(COMMAND[0], COMMAND)

    started_at = time.monotonic()
    output = ""
    safe_prompts_handled = 0
    safe_prompts_seen = 0
    awaiting_safe_option = False
    rejected_unsafe_change = False

    try:
        while True:
            if time.monotonic() - started_at > TIMEOUT_SECONDS:
                os.kill(pid, signal.SIGTERM)
                print(
                    "\nSafe Drizzle push timed out before completion.",
                    file=sys.stderr,
                )
                return 124

            readable, _, _ = select.select([fd], [], [], 0.25)
            if readable:
                try:
                    chunk = os.read(fd, 4096)
                except OSError:
                    chunk = b""

                if chunk:
                    sys.stdout.buffer.write(chunk)
                    sys.stdout.buffer.flush()
                    output += ANSI_ESCAPE.sub("", chunk.decode(errors="replace"))
                    output = output[-20000:]

                    prompt_count = output.count(SAFE_PROMPT)
                    if prompt_count > safe_prompts_seen:
                        safe_prompts_seen = prompt_count
                        awaiting_safe_option = True

                    if awaiting_safe_option and SAFE_OPTION in output:
                        # The default option is "No, add the constraint without
                        # truncating the table", so Enter preserves existing rows.
                        os.write(fd, b"\r")
                        safe_prompts_handled += 1
                        awaiting_safe_option = False
                        output = ""
                        safe_prompts_seen = 0

                    if UNSAFE_PROMPT in output and not rejected_unsafe_change:
                        # The default option is "No, abort". Reject unknown
                        # destructive changes and make the setup fail clearly.
                        os.write(fd, b"\r")
                        rejected_unsafe_change = True
                else:
                    break

            finished_pid, status = os.waitpid(pid, os.WNOHANG)
            if finished_pid == pid:
                if rejected_unsafe_change:
                    print(
                        "\nDrizzle detected a destructive schema change and "
                        "the safe post-merge setup rejected it.",
                        file=sys.stderr,
                    )
                    return 2
                return os.waitstatus_to_exitcode(status)
    finally:
        try:
            os.close(fd)
        except OSError:
            pass

    _, status = os.waitpid(pid, 0)
    if rejected_unsafe_change:
        print(
            "\nDrizzle detected a destructive schema change and "
            "the safe post-merge setup rejected it.",
            file=sys.stderr,
        )
        return 2
    return os.waitstatus_to_exitcode(status)


if __name__ == "__main__":
    raise SystemExit(main())