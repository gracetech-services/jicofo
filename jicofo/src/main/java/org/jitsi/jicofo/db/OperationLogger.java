package org.jitsi.jicofo.db;

public class OperationLogger {
    private static OperationLogger instance;
    private OperationLogger() {
    }

    public static synchronized OperationLogger getInstance() {
        if (instance == null) {
            instance = new OperationLogger();
        }
        return instance;
    }

    public void logJoinConference(String userId, String roomId,String meetingId) {
        DatabaseManager.getInstance().logUserOperation(userId, roomId, meetingId,"JOIN_CONFERENCE", "{}");
    }

//    public void logLeaveConference(String userId, String roomId) {
//        DatabaseManager.getInstance().logUserOperation(userId, roomId, "LEAVE_CONFERENCE", "{}");
//    }
//
//    public void logMuteAudio(String userId, String roomId, boolean muted) {
//        DatabaseManager.getInstance().logUserOperation(userId, roomId, "MUTE_AUDIO", "{\"muted\": " + muted + "}");
//    }
//
//    public void logMuteVideo(String userId, String roomId, boolean muted) {
//        DatabaseManager.getInstance().logUserOperation(userId, roomId, "MUTE_VIDEO", "{\"muted\": " + muted + "}");
//    }
}
