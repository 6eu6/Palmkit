# Runtime image for USER projects (AI-generated, untrusted).
# Kept minimal; a non-root "sandbox" user owns the project dir.
FROM node:20-slim

# Tools the dev servers commonly need; keep this lean for fast cold starts.
RUN apt-get update \
  && apt-get install -y --no-install-recommends bash ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Non-root user
RUN useradd -m -u 10001 sandbox \
  && mkdir -p /home/project \
  && chown -R sandbox:sandbox /home/project

WORKDIR /home/project
USER sandbox

# Faster, quieter installs inside the sandbox
ENV CI=true \
    npm_config_fund=false \
    npm_config_audit=false \
    npm_config_update_notifier=false

EXPOSE 3000
CMD ["sleep", "infinity"]
