class HealthChecker {
    getCurrentHealth() {
        return { success: true, message: 'OK' };
    }
}

module.exports = new HealthChecker(); 