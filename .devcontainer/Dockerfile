FROM mcr.microsoft.com/devcontainers/javascript-node:20-bookworm

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
    libnss3 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libatspi2.0-0 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxcursor1 \
    libxrandr2 \
    libxkbcommon0 \
    libgbm1 \
    libasound2 \
    libdrm2 \
    libdbus-1-3 \
    libcups2 \
    libgtk-3-0 \
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
