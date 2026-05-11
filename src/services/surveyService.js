import { db } from '../db/index.js';
import { surveys, surveyQuestions } from '../models/surveys.js';
import { eq, and } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { surveyResponses } from '../models/surveys.js';

// Get all surveys
export async function getAllSurveysServiceForUser(userId) {
  const result = await db.execute(sql`
    SELECT 
      s.*,
      st.name as survey_type_name,
      o.name as organization_name,
      o.image_url as organization_image_url,
      o.image_key as organization_image_key,
      EXISTS (
        SELECT 1 
        FROM survey_responses sr 
        WHERE sr.survey_id = s.id 
        AND sr.user_id = ${userId}
      ) as has_responded,
      COALESCE(
        JSON_AGG(
          JSON_BUILD_OBJECT(
            'id', su.id,
            'description', su.description,
            'hasLink', su.has_link,
            'linkUrl', su.link_url,
            'createdAt', su.created_at,
            'updatedAt', su.updated_at
          ) ORDER BY su.created_at DESC
        ) FILTER (WHERE su.id IS NOT NULL),
        '[]'
      ) as updates
    FROM surveys s
    LEFT JOIN survey_types st ON s.survey_type_id = st.id
    LEFT JOIN organization_surveys os ON s.id = os.survey_id
    LEFT JOIN organizations o ON os.organization_id = o.id
    LEFT JOIN survey_updates su ON s.id = su.survey_id
    GROUP BY 
      s.id, 
      st.name, 
      o.name, 
      o.image_url, 
      o.image_key
  `);
  return result.rows;
}

// Get survey by ID
export async function getSurveyByIdService(id, tenantIds) {
  const tenantIdsString = tenantIds.map((id) => `'${id}'`).join(',');
  const result = await db.execute(sql`
    SELECT 
      s.*,
      st.name as survey_type_name,
      COALESCE(
        JSON_AGG(
          JSON_BUILD_OBJECT(
            'id', o.id,
            'name', o.name,
            'imageUrl', o.image_url,
            'imageKey', o.image_key
          ) 
        ) FILTER (WHERE o.id IS NOT NULL),
        '[]'
      ) as organizations
    FROM surveys s
    LEFT JOIN survey_types st ON s.survey_type_id = st.id
    LEFT JOIN organization_surveys os ON s.id = os.survey_id
    LEFT JOIN organizations o ON os.organization_id = o.id
    WHERE s.id = ${id}
    AND s.tenant_id IN (${sql.raw(tenantIdsString)})
    GROUP BY s.id, st.name
  `);

  return result.rows[0];
}

export async function getSurveyResponsesWithAnswersService(surveyId) {
  try {
    const responses = await db.execute(sql`
      WITH grouped_responses AS (
        SELECT
          sr.id as response_id,
          sr.created_at as response_date,
          sr.user_id,
          JSON_AGG(
            JSON_BUILD_OBJECT(
              'questionId', sq.id,
              'reportHeader', sq.report_header,
              'question', sq.question,
              'questionType', sq.question_type,
              'answer', sa.answer,
              'responseId', sr.id
            ) ORDER BY sq.id
          ) as answers
        FROM survey_responses sr
        JOIN survey_answers sa ON sr.id = sa.response_id
        JOIN questions sq ON sa.question_id = sq.id
        JOIN surveys s ON sr.survey_id = s.id
        WHERE s.id = ${surveyId}
        GROUP BY sr.id, sr.created_at, sr.user_id
      )
      SELECT *
      FROM grouped_responses
      ORDER BY response_date;
    `);

    if (!responses) {
      return [];
    }

    // Parse any stringified JSON in the answers
    return responses.rows.map((response) => ({
      ...response,
      answers: response.answers.map((answer) => ({
        ...answer,
        answer: tryParseJSON(answer.answer),
      })),
    }));
  } catch (error) {
    console.error('Error fetching survey responses:', error);
    throw new Error(`Failed to fetch responses for survey ID: ${surveyId}`);
  }
}

// Helper function to safely parse JSON strings
function tryParseJSON(str) {
  try {
    // Check if the string looks like JSON
    if (
      typeof str === 'string' &&
      (str.startsWith('[') || str.startsWith('{'))
    ) {
      return JSON.parse(str);
    }
    return str;
  } catch (e) {
    return str;
  }
}

export async function createSurveyResponseService({ surveyId, answers }) {
  try {
    if (!surveyId) {
      throw new Error('surveyId is required');
    }

    const parsedAnswers =
      typeof answers === 'string' ? JSON.parse(answers) : answers;

    if (!Array.isArray(parsedAnswers) || parsedAnswers.length === 0) {
      throw new Error('answers must be a non-empty array');
    }

    // Validate the answer structure
    parsedAnswers.forEach((answer, index) => {
      if (!answer.questionId) {
        throw new Error(`Missing questionId in answer at index ${index}`);
      }
      if (!answer.answer && answer.answer !== '') {
        throw new Error(`Missing answer value in answer at index ${index}`);
      }
    });

    // Format the answers
    const formattedAnswers = parsedAnswers.map((answer) => ({
      question_id: answer.questionId,
      answer: answer.answer,
    }));
    const result = await db.execute(`
      WITH new_response AS (
        INSERT INTO survey_responses (survey_id, created_at)
        VALUES ('${surveyId}', CURRENT_TIMESTAMP)
        RETURNING id
      ),
      answer_inserts AS (
        INSERT INTO survey_answers (response_id, question_id, answer)
        SELECT
          new_response.id,
          q.question_id,
          q.answer
        FROM new_response,
          json_to_recordset('${JSON.stringify(
            formattedAnswers
          )}'::json) AS q(question_id uuid, answer text)
      )
      SELECT id FROM new_response;
    `);

    return result.rows[0];
  } catch (error) {
    console.error('Error creating survey response:', error);
    throw new Error(`Failed to create survey response: ${error.message}`);
  }
}

export async function updateSurveyResponseService({
  responseId,
  answers,
  userId,
}) {
  try {
    if (!responseId) {
      throw new Error('responseId is required');
    }

    if (!userId) {
      throw new Error('userId is required');
    }

    const parsedAnswers =
      typeof answers === 'string' ? JSON.parse(answers) : answers;

    if (!Array.isArray(parsedAnswers) || parsedAnswers.length === 0) {
      throw new Error('answers must be a non-empty array');
    }

    // Validate the answer structure
    parsedAnswers.forEach((answer, index) => {
      if (!answer.questionId) {
        throw new Error(`Missing questionId in answer at index ${index}`);
      }
      if (!answer.answer && answer.answer !== '') {
        throw new Error(`Missing answer value in answer at index ${index}`);
      }
    });

    // Format the answers
    const formattedAnswers = parsedAnswers.map((answer) => ({
      question_id: answer.questionId,
      answer: answer.answer,
    }));

    // Insert new answers and create audit log entries
    const result = await db.execute(sql`
      WITH current_answers AS (
        SELECT question_id, answer
        FROM survey_answers
        WHERE response_id = ${responseId}
      ),
      new_answers AS (
        INSERT INTO survey_answers (response_id, question_id, answer)
        SELECT 
          ${responseId},
          q.question_id,
          q.answer
        FROM json_to_recordset(${JSON.stringify(formattedAnswers)}::json) 
          AS q(question_id uuid, answer text)
        ON CONFLICT (response_id, question_id) 
        DO UPDATE SET answer = EXCLUDED.answer
        RETURNING *
      )
      INSERT INTO survey_answers_audit (
        response_id,
        question_id,
        old_answer,
        new_answer,
        changed_by,
        change_type
      )
      SELECT 
        ${responseId},
        new_answers.question_id,
        current_answers.answer,
        new_answers.answer,
        ${userId},
        CASE 
          WHEN current_answers.answer IS NULL THEN 'INSERT'
          ELSE 'UPDATE'
        END
      FROM new_answers
      LEFT JOIN current_answers ON new_answers.question_id = current_answers.question_id
      WHERE new_answers.answer IS DISTINCT FROM current_answers.answer
      RETURNING response_id;
    `);

    return result.rows[0];
  } catch (error) {
    console.error('Error updating survey response:', error);
    throw new Error(`Failed to update survey response: ${error.message}`);
  }
}

// Helper function to get audit history for a response
export async function getSurveyResponseAuditHistory(responseId) {
  try {
    const result = await db.execute(sql`
      SELECT 
        sa.*,
        u.name as changed_by_name,
        q.question as question_text
      FROM survey_answers_audit sa
      JOIN users u ON sa.changed_by = u.id
      JOIN questions q ON sa.question_id = q.id
      WHERE sa.response_id = ${responseId}
      ORDER BY sa.changed_at DESC
    `);

    return result.rows;
  } catch (error) {
    console.error('Error fetching survey response audit history:', error);
    throw new Error(
      `Failed to fetch audit history for response ID: ${responseId}`
    );
  }
}

export async function updateSurveyService(surveyId, surveyData) {
  try {
    // Extract and ensure arrays for organizations
    const orgsToAdd = Array.isArray(surveyData.orgsToAdd)
      ? surveyData.orgsToAdd
      : [];
    const organizationsToRemove = Array.isArray(
      surveyData.organizationsToRemove
    )
      ? surveyData.organizationsToRemove
      : [];

    // Remove properties we don't want to include in the survey update
    const {
      orgsToAdd: _orgsToAdd,
      organizationsToRemove: _organizationsToRemove,
      organizations: _organizations,
      ...updatedSurveyData
    } = surveyData;

    return await db.transaction(async (tx) => {
      // Remove organizations if specified
      if (organizationsToRemove.length > 0) {
        await tx.execute(
          sql`DELETE FROM organization_surveys 
              WHERE survey_id = ${surveyId} 
              AND organization_id = ANY(ARRAY[${sql.join(
                organizationsToRemove
              )}]::uuid[])`
        );
      }

      // Add new organizations if specified
      if (orgsToAdd.length > 0) {
        const values = orgsToAdd.map((orgId) => ({
          survey_id: surveyId,
          organization_id: orgId,
        }));

        await tx.execute(
          sql`INSERT INTO organization_surveys (survey_id, organization_id)
              SELECT * FROM json_to_recordset(${JSON.stringify(values)}::json)
              AS t(survey_id uuid, organization_id uuid)
              ON CONFLICT DO NOTHING`
        );
      }

      // Update the survey
      const result = await tx.execute(
        sql`
          UPDATE surveys
          SET 
            name = COALESCE(${updatedSurveyData.name ?? null}, name),
            description = COALESCE(${
              updatedSurveyData.description ?? null
            }, description),
            survey_type_id = COALESCE(${
              updatedSurveyData.surveyTypeId ?? null
            }, survey_type_id),
            open_date = COALESCE(${
              updatedSurveyData.openDate
                ? sql`${updatedSurveyData.openDate}::timestamp`
                : null
            }, open_date),
            close_date = COALESCE(${
              updatedSurveyData.closeDate
                ? sql`${updatedSurveyData.closeDate}::timestamp`
                : null
            }, close_date),
            link = COALESCE(${updatedSurveyData.link ?? null}, link),
            updated_at = CURRENT_TIMESTAMP
          WHERE id = ${surveyId}
          RETURNING *`
      );

      return result.rows[0];
    });
  } catch (error) {
    console.error('Error in updateSurveyService:', error);
    throw error;
  }
}

export const getUserRespondedSurveys = async (userId) => {
  const result = await db
    .select({
      id: surveys.id,
      name: surveys.name,
      description: surveys.description,
      openDate: surveys.openDate,
      closeDate: surveys.closeDate,
      link: surveys.link,
      published: surveys.published,
      createdAt: surveys.createdAt,
      updatedAt: surveys.updatedAt,
    })
    .from(surveys)
    .innerJoin(
      surveyResponses,
      and(
        eq(surveyResponses.surveyId, surveys.id),
        eq(surveyResponses.userId, userId)
      )
    );

  return result;
};

export async function hasUserRespondedToSurvey(surveyId, userId) {
  try {
    const result = await db.execute(sql`
      SELECT EXISTS (
        SELECT 1 
        FROM survey_responses 
        WHERE survey_id = ${surveyId} 
        AND user_id = ${userId}
      ) as has_responded
    `);

    return result.rows[0]?.has_responded || false;
  } catch (error) {
    console.error('Error checking user survey response:', error);
    throw new Error(
      `Failed to check response status for survey ID: ${surveyId}`
    );
  }
}

export async function markSurveyAsResponded(surveyId, userId) {
  try {
    const result = await db.execute(sql`
      INSERT INTO survey_responses (survey_id, user_id)
      VALUES (${surveyId}, ${userId})
      RETURNING id
    `);

    return result.rows[0];
  } catch (error) {
    console.error('Error marking survey as responded:', error);
    throw new Error(`Failed to mark survey as responded: ${error.message}`);
  }
}

export async function getUserSurveyResponseIds(userId) {
  try {
    const result = await db.execute(sql`
      SELECT DISTINCT survey_id
      FROM survey_responses
      WHERE user_id = ${userId}
      ORDER BY survey_id;
    `);
    return result.rows.map((row) => row.survey_id);
  } catch (error) {
    console.error('Error fetching user survey responses:', error);
    throw new Error(`Failed to fetch user survey responses: ${error.message}`);
  }
}

export async function getSurveysByIds(surveyIds) {
  try {
    if (!surveyIds.length) return [];

    const result = await db.execute(sql`
      SELECT 
        s.*,
        st.name as survey_type_name,
        o.name as organization_name,
        o.image_url as organization_image_url,
        o.image_key as organization_image_key,
        COALESCE(
          JSON_AGG(
            DISTINCT jsonb_build_object(
              'id', su.id,
              'description', su.description,
              'hasLink', su.has_link,
              'linkUrl', su.link_url,
              'createdAt', su.created_at,
              'updatedAt', su.updated_at
            ) FILTER (WHERE su.id IS NOT NULL)
          ),
          '[]'
        ) as updates
      FROM surveys s
      LEFT JOIN survey_types st ON s.survey_type_id = st.id
      LEFT JOIN organization_surveys os ON s.id = os.survey_id
      LEFT JOIN organizations o ON os.organization_id = o.id
      LEFT JOIN survey_updates su ON s.id = su.survey_id
      WHERE s.id = ANY(${sql.array(surveyIds, 'uuid')})
      GROUP BY 
        s.id,
        st.name,
        o.name,
        o.image_url,
        o.image_key
    `);
    return result.rows;
  } catch (error) {
    console.error('Error fetching surveys by IDs:', error);
    throw new Error(`Failed to fetch surveys: ${error.message}`);
  }
}

export async function getAllSurveysService(userId, tenantIds) {
  // Convert tenantIds array to a string of comma-separated UUIDs
  const tenantIdsString = tenantIds.map((id) => `'${id}'`).join(',');

  const result = await db.execute(sql`
    SELECT 
      s.*,
      COALESCE(
        JSON_AGG(
          jsonb_build_object(
            'id', o.id,
            'name', o.name,
            'description', o.description,
            'imageUrl', o.image_url,
            'imageKey', o.image_key,
            'imageUrl', o.image_url,
            'imageKey', o.image_key
          )
        ) FILTER (WHERE o.id IS NOT NULL),
        '[]'
      ) as organizations
    FROM surveys s  
    LEFT JOIN organization_surveys os ON s.id = os.survey_id
    LEFT JOIN organizations o ON os.organization_id = o.id
    WHERE s.tenant_id IN (${sql.raw(tenantIdsString)})
    GROUP BY s.id
  `);

  return result.rows;
}

export const createSurveyService = async (surveyData) => {
  const { organizations, ...surveyFields } = surveyData;

  try {
    return await db.transaction(async (tx) => {
      // Create the survey using Drizzle insert syntax
      const result = await tx.insert(surveys).values(surveyFields).returning();

      const survey = result[0];

      // If there are organizations, create the associations
      if (organizations?.length > 0) {
        const values = organizations.map((orgId) => ({
          survey_id: survey.id,
          organization_id: orgId,
        }));

        await tx.execute(sql`
          INSERT INTO organization_surveys (survey_id, organization_id)
          SELECT * FROM json_to_recordset(${JSON.stringify(values)}::json)
          AS t(survey_id uuid, organization_id uuid)
        `);
      }

      return survey;
    });
  } catch (error) {
    console.error('Error in createSurveyService:', error);
    throw error;
  }
};

export async function deleteSurveyService(id) {
  return await db.transaction(async (tx) => {
    // Delete organization associations first
    await tx.execute(sql`
      DELETE FROM organization_surveys 
      WHERE survey_id = ${id}
    `);

    // Delete the survey itself
    const result = await tx.execute(sql`
      DELETE FROM surveys 
      WHERE id = ${id}
      RETURNING *
    `);

    return result.rows[0]; // Return the first (and should be only) deleted survey
  });
}
