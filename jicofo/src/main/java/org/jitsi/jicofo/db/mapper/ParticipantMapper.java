package org.jitsi.jicofo.db.mapper;

import org.apache.ibatis.annotations.*;
import org.jitsi.jicofo.storage.ParticipantInfo;
import java.util.List;

/**
 * 参会人员Mapper接口
 */
public interface ParticipantMapper {
    
    /**
     * 插入参会人员信息
     */
    @Insert("INSERT INTO conference_participants " +
            "(user_id, room_name, meeting_id, role, audio_muted, video_muted, features, joined_at) " +
            "VALUES (#{userId}, #{roomName}, #{meetingId}, #{role}, #{audioMuted}, #{videoMuted}, #{featuresStr}, #{joinedAt})")
    int insertParticipant(ParticipantInfo participant);
    
    /**
     * 更新参会人员离开时间
     */
    @Update("UPDATE conference_participants SET left_at = #{leftAt} " +
            "WHERE user_id = #{userId} AND room_name = #{roomName} AND left_at IS NULL")
    int updateParticipantLeftTime(@Param("userId") String userId, 
                                 @Param("roomName") String roomName,
                                 @Param("leftAt") java.sql.Timestamp leftAt);
    
    /**
     * 更新参会人员音视频状态
     */
    @Update("UPDATE conference_participants SET audio_muted = #{audioMuted}, video_muted = #{videoMuted} " +
            "WHERE user_id = #{userId} AND room_name = #{roomName} AND left_at IS NULL")
    int updateParticipantMediaStatus(@Param("userId") String userId,
                                   @Param("roomName") String roomName,
                                   @Param("audioMuted") boolean audioMuted,
                                   @Param("videoMuted") boolean videoMuted);
    
    /**
     * 查询会议的所有参会人员
     */
    @Select("SELECT * FROM conference_participants WHERE room_name = #{roomName} ORDER BY joined_at")
    List<ParticipantInfo> selectByRoomName(@Param("roomName") String roomName);
    
    /**
     * 查询会议的当前在线参会人员
     */
    @Select("SELECT * FROM conference_participants WHERE room_name = #{roomName} AND left_at IS NULL ORDER BY joined_at")
    List<ParticipantInfo> selectActiveParticipants(@Param("roomName") String roomName);
    
    /**
     * 查询用户的参会历史
     */
    @Select("SELECT * FROM conference_participants WHERE user_id = #{userId} ORDER BY joined_at DESC")
    List<ParticipantInfo> selectByUserId(@Param("userId") String userId);
    
    /**
     * 统计会议参会人数
     */
    @Select("SELECT COUNT(DISTINCT user_id) FROM conference_participants WHERE room_name = #{roomName}")
    int countParticipants(@Param("roomName") String roomName);
    
    /**
     * 删除会议的所有参会人员记录
     */
    @Delete("DELETE FROM conference_participants WHERE room_name = #{roomName}")
    int deleteByRoomName(@Param("roomName") String roomName);
}