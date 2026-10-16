FROM mcr.microsoft.com/devcontainers/javascript-node:24-bookworm

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    python3 \
    pkg-config \
    libcairo2-dev \
    libjpeg-dev \
    libpango1.0-dev \
    libgif-dev \
    librsvg2-dev \
    libpixman-1-dev \
    libvips-dev \
    libsqlite3-dev \
    postgresql-client \
  && rm -rf /var/lib/apt/lists/*

# All browsers (Chromium, Firefox, WebKit) - single source of truth; bump @1.x.x when upgrading @playwright/test in package-lock.json.
RUN npx -y playwright@1.58.2 install-deps \
  && rm -rf /var/lib/apt/lists/*

# GitHub CLI: `npm run codespaces:ports-public` and codespaces-up port visibility automation.
# git-lfs: satisfy repo hooks when Git LFS is configured.
RUN apt-get update && apt-get install -y --no-install-recommends \
    wget \
    ca-certificates \
    git-lfs \
  && mkdir -p -m 755 /etc/apt/keyrings \
  && wget -qO- https://cli.github.com/packages/githubcli-archive-keyring.gpg \
    | tee /etc/apt/keyrings/githubcli-archive-keyring.gpg > /dev/null \
  && chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg \
  && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
    | tee /etc/apt/sources.list.d/github-cli.list > /dev/null \
  && apt-get update && apt-get install -y --no-install-recommends gh \
  && git lfs install --system \
  && rm -rf /var/lib/apt/lists/*
