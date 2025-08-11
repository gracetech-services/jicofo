package org.jitsi.jicofo.db.mapper;

import org.apache.ibatis.annotations.*;
import org.jitsi.jicofo.storage.ConferenceInfo;
import java.util.List;

/**
 * 会议信息Mapper接口
 */
public interface ConferenceMapper {
    
    /**
     * 插入会议信息
     */
    @Insert("INSERT INTO jicofo_conference (room_name, meeting_id, started, include_in_statistics, jvb_version) " +
            "VALUES (#{roomName}, #{meetingId}, #{started}, #{includeInStatistics}, #{jvbVersion}) " +
            "ON DUPLICATE KEY UPDATE meeting_id=VALUES(meeting_id), started=VALUES(started)")
    int insertConference(ConferenceInfo conference);
    
    /**
     * 根据房间名查询会议信息
     */
    @Select("SELECT * FROM jicofo_conference WHERE room_name = #{roomName}")
    ConferenceInfo selectByRoomName(@Param("roomName") String roomName);
    
    /**
     * 根据会议ID查询会议信息
     */
    @Select("SELECT * FROM jicofo_conference WHERE meeting_id = #{meetingId}")
    ConferenceInfo selectByMeetingId(@Param("meetingId") String meetingId);
    
    /**
     * 更新会议结束时间
     */
    @Update("UPDATE jicofo_conference SET ended_at = #{endedAt}, participant_count = #{participantCount} " +
            "WHERE room_name = #{roomName}")
    int updateConferenceEndTime(@Param("roomName") String roomName, 
                               @Param("endedAt") java.sql.Timestamp endedAt,
                               @Param("participantCount") int participantCount);
    
    /**
     * 更新会议状态
     */
    @Update("UPDATE jicofo_conference SET started = #{started} WHERE room_name = #{roomName}")
    int updateConferenceStatus(@Param("roomName") String roomName, @Param("started") boolean started);

    /**
     * 删除会议
     */
    @Delete("DELETE FROM jicofo_conference WHERE room_name = #{roomName}")
    int deleteConference(@Param("roomName") String roomName);

    /**
     * 查询所有活跃会议
     */
    @Select("SELECT * FROM jicofo_conference WHERE ended_at IS NULL ORDER BY create_time DESC")
    List<ConferenceInfo> selectActiveConferences();

    /**
     * 统计会议数量
     */
    @Select("SELECT COUNT(*) FROM jicofo_conference WHERE create_time >= #{startTime} AND create_time <= #{endTime}")
    int countConferences(@Param("startTime") java.sql.Timestamp startTime,
                        @Param("endTime") java.sql.Timestamp endTime);
}