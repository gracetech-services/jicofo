#!/usr/bin/env bash
set -e

# Set the base directory to the script's location
BASEDIR="$(cd "$(dirname "$0")" && pwd)"

# Path to the main JAR
JICOFO_JAR="$BASEDIR/jicofo/target/jicofo-*.jar"

# Build the classpath from all module JARs and their dependencies
CLASSPATH="$BASEDIR/jicofo/target/classes:$BASEDIR/jicofo-common/target/classes:$BASEDIR/jicofo-selector/target/classes"
for jar in $BASEDIR/jicofo/target/dependency/*.jar $BASEDIR/jicofo-common/target/dependency/*.jar $BASEDIR/jicofo-selector/target/dependency/*.jar; do
  CLASSPATH="$CLASSPATH:$jar"
done

# Example environment variables for config (adjust as needed)
export JICOFO_CONFIG_DIR="$BASEDIR/resources/config"
export LOGGING_CONFIG="$BASEDIR/lib/logging.properties"
CONFIG_FILE="$BASEDIR/jicofo-selector/src/main/resources/localhost.reference.conf"

# Run the main class
exec java -cp "$CLASSPATH:$JICOFO_JAR" -Djava.util.logging.config.file="$LOGGING_CONFIG" -Dconfig.file="$CONFIG_FILE" org.jitsi.jicofo.Main "$@" 
