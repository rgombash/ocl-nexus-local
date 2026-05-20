# OCL Nexus Python Sandbox
# - Python 3.12 with pip, venv, and build tools
# - Homebrew for runtime CLI tool installation
# - Non-root user (UID 1000) for PVC compatibility
# - Keeps container alive for Developer API calls

FROM ubuntu:24.04

# Prevent interactive prompts during package installation
ENV DEBIAN_FRONTEND=noninteractive

# Install Python 3 and essential build tools
RUN apt-get update -qq && \
    apt-get install -y -qq --no-install-recommends \
      python3 \
      python3-pip \
      python3-venv \
      build-essential \
      curl \
      git \
      sudo \
      procps \
      file \
      ca-certificates && \
    rm -rf /var/lib/apt/lists/*

# Create node user (UID 1000) for compatibility with OCL Nexus PVC permissions
# Ubuntu 24.04 creates a default user/group with UID/GID 1000 - rename it to 'node'
RUN if id 1000 2>/dev/null; then \
      existing_user=$(id -un 1000); \
      if [ "$existing_user" != "node" ]; then \
        usermod -l node "$existing_user"; \
        groupmod -n node $(id -gn 1000) 2>/dev/null || true; \
        usermod -d /home/node -m node 2>/dev/null || true; \
      fi; \
    else \
      groupadd -g 1000 node; \
      useradd -u 1000 -g 1000 -m -s /bin/bash node; \
    fi && \
    usermod -s /bin/bash node 2>/dev/null || true && \
    echo "node ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers

# Pre-create Homebrew directory with correct permissions
RUN mkdir -p /home/linuxbrew && chown -R 1000:1000 /home/linuxbrew

USER node
WORKDIR /app

# Install Homebrew (CI=1 skips sudo apt-get, NONINTERACTIVE=1 skips prompts)
RUN CI=1 NONINTERACTIVE=1 /bin/bash -c \
    "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Set Homebrew environment variables
ENV HOMEBREW_PREFIX=/home/linuxbrew/.linuxbrew
ENV HOMEBREW_CELLAR=/home/linuxbrew/.linuxbrew/Cellar
ENV HOMEBREW_REPOSITORY=/home/linuxbrew/.linuxbrew/Homebrew
ENV HOMEBREW_NO_AUTO_UPDATE=1
ENV HOMEBREW_NO_ANALYTICS=1
ENV PATH="/home/linuxbrew/.linuxbrew/bin:/home/linuxbrew/.linuxbrew/sbin:${PATH}"

# Persist brew shellenv in shell profiles
RUN echo 'eval "$(/home/linuxbrew/.linuxbrew/bin/brew shellenv)"' >> /home/node/.bashrc && \
    echo 'eval "$(/home/linuxbrew/.linuxbrew/bin/brew shellenv)"' >> /home/node/.profile

# Smoke test: verify Python and Homebrew work
RUN python3 --version && brew --version

# Switch to root to install entrypoint
USER root

# Copy Nexus Entrypoint bootloader (owned by root, readable by all)
COPY --chown=root:root docker/sandboxes/nexus-entrypoint.sh /usr/local/bin/nexus-entrypoint.sh
RUN chmod 755 /usr/local/bin/nexus-entrypoint.sh

# Switch back to node user for runtime
USER node

# Use Nexus Entrypoint: executes /app/nexus-start.sh if present, else idle mode
CMD ["/usr/local/bin/nexus-entrypoint.sh"]
