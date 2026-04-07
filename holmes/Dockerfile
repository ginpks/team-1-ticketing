FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive \
    LANG=en_US.UTF-8 \
    TERM=xterm-256color

# ── Locale + base packages ────────────────────────────────────────────────────
RUN apt-get update && apt-get install -y --no-install-recommends \
        locales \
        bash bash-completion \
        curl wget git \
        jq \
        build-essential ca-certificates gnupg \
        unzip zip tar gzip xz-utils \
        less man-db sudo tmux watch \
        python3 python3-pip python3-venv python3-dev \
        postgresql-client \
        redis-tools \
        httpie \
        ripgrep \
        fd-find \
        netcat-openbsd \
        dnsutils \
        iputils-ping \
        lsof \
        procps \
    && locale-gen en_US.UTF-8 \
    && ln -sf /usr/bin/fdfind /usr/local/bin/fd \
    && rm -rf /var/lib/apt/lists/*

# ── bat (batcat on Ubuntu — alias to bat) ─────────────────────────────────────
RUN apt-get update && apt-get install -y --no-install-recommends bat \
    && ln -sf /usr/bin/batcat /usr/local/bin/bat \
    && rm -rf /var/lib/apt/lists/*

# ── lsd ───────────────────────────────────────────────────────────────────────
RUN set -eux; \
    DPKG_ARCH=$(dpkg --print-architecture); \
    LSD_VER=$(curl -fsSL "https://api.github.com/repos/lsd-rs/lsd/releases/latest" \
              | jq -r .tag_name | tr -d 'v'); \
    curl -fsSL "https://github.com/lsd-rs/lsd/releases/download/v${LSD_VER}/lsd_${LSD_VER}_${DPKG_ARCH}.deb" \
         -o /tmp/lsd.deb \
    && dpkg -i /tmp/lsd.deb \
    && rm /tmp/lsd.deb

# ── yq (YAML processor, complements jq) ──────────────────────────────────────
RUN set -eux; \
    DPKG_ARCH=$(dpkg --print-architecture); \
    case "$DPKG_ARCH" in \
        amd64) YQ_ARCH="amd64" ;; \
        arm64) YQ_ARCH="arm64" ;; \
        *) echo "Unsupported arch: $DPKG_ARCH" && exit 1 ;; \
    esac; \
    curl -fsSL "https://github.com/mikefarah/yq/releases/latest/download/yq_linux_${YQ_ARCH}" \
         -o /usr/local/bin/yq \
    && chmod +x /usr/local/bin/yq

# ── Node.js (LTS) ─────────────────────────────────────────────────────────────
RUN curl -fsSL https://deb.nodesource.com/setup_lts.x | bash - \
    && apt-get install -y nodejs \
    && npm install -g npm@latest \
    && rm -rf /var/lib/apt/lists/*

# ── k6 ────────────────────────────────────────────────────────────────────────
RUN curl -fsSL https://dl.k6.io/key.gpg \
        | gpg --dearmor -o /usr/share/keyrings/k6-archive-keyring.gpg \
    && echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" \
        | tee /etc/apt/sources.list.d/k6.list \
    && apt-get update && apt-get install -y k6 \
    && rm -rf /var/lib/apt/lists/*

# ── Neovim (latest release) ───────────────────────────────────────────────────
RUN set -eux; \
    DPKG_ARCH=$(dpkg --print-architecture); \
    case "$DPKG_ARCH" in \
        amd64) NVIM_ARCH="x86_64" ;; \
        arm64) NVIM_ARCH="arm64"  ;; \
        *) echo "Unsupported arch: $DPKG_ARCH" && exit 1 ;; \
    esac; \
    curl -fsSL "https://github.com/neovim/neovim/releases/latest/download/nvim-linux-${NVIM_ARCH}.tar.gz" \
         | tar -xz -C /opt \
    && ln -sf "/opt/nvim-linux-${NVIM_ARCH}/bin/nvim" /usr/local/bin/nvim

# ── LazyVim starter config (plugins install on first nvim launch) ─────────────
RUN git clone https://github.com/LazyVim/starter /root/.config/nvim \
    && rm -rf /root/.config/nvim/.git

# ── Shell conveniences ────────────────────────────────────────────────────────
RUN cat >> /root/.bashrc << 'EOF'

# lsd aliases
alias ll="lsd -la"
alias l="lsd -l"
alias lt="lsd --tree"

# bat instead of cat
alias cat="bat --paging=never"

# quick health check loop
# usage: healthcheck http://my-service:3000/health
healthcheck() {
    watch -n 2 "curl -s $1 | jq ."
}
EOF

WORKDIR /workspace

# Stay alive so `docker compose exec holmes bash` works
CMD ["sleep", "infinity"]
