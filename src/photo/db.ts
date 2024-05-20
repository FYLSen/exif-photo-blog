import {
  sql,
  query,
  convertArrayToPostgresString,
} from '@/services/postgres';
import {
  PhotoDb,
  PhotoDbInsert,
  translatePhotoId,
  parsePhotoFromDb,
  Photo,
  PhotoDateRange,
} from '@/photo';
import { Camera, Cameras, createCameraKey } from '@/camera';
import { parameterize } from '@/utility/string';
import { TagsWithMeta } from '@/tag';
import { FilmSimulation, FilmSimulations } from '@/simulation';
import { SHOULD_DEBUG_SQL, PRIORITY_ORDER_ENABLED } from '@/site/config';

export const GENERATE_STATIC_PARAMS_LIMIT = 1000;

const PHOTO_DEFAULT_LIMIT = 100;

const sqlCreatePhotosTable = () =>
  sql`
    CREATE TABLE IF NOT EXISTS photos (
      id VARCHAR(8) PRIMARY KEY,
      url VARCHAR(255) NOT NULL,
      extension VARCHAR(255) NOT NULL,
      aspect_ratio REAL DEFAULT 1.5,
      blur_data TEXT,
      title VARCHAR(255),
      caption TEXT,
      semantic_description TEXT,
      tags VARCHAR(255)[],
      make VARCHAR(255),
      model VARCHAR(255),
      focal_length SMALLINT,
      focal_length_in_35mm_format SMALLINT,
      f_number REAL,
      iso SMALLINT,
      exposure_time DOUBLE PRECISION,
      exposure_compensation REAL,
      location_name VARCHAR(255),
      latitude DOUBLE PRECISION,
      longitude DOUBLE PRECISION,
      film_simulation VARCHAR(255),
      priority_order REAL,
      taken_at TIMESTAMP WITH TIME ZONE NOT NULL,
      taken_at_naive VARCHAR(255) NOT NULL,
      hidden BOOLEAN,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    )
  `;

// Migration 01
const MIGRATION_FIELDS_01 = ['caption', 'semantic_description'];
const sqlRunMigration01 = () =>
  sql`
    ALTER TABLE photos
    ADD COLUMN IF NOT EXISTS caption TEXT,
    ADD COLUMN IF NOT EXISTS semantic_description TEXT
  `;

// Must provide id as 8-character nanoid
export const sqlInsertPhoto = (photo: PhotoDbInsert) =>
  safelyQueryPhotos(() => sql`
    INSERT INTO photos (
      id,
      url,
      extension,
      aspect_ratio,
      blur_data,
      title,
      caption,
      semantic_description,
      tags,
      make,
      model,
      focal_length,
      focal_length_in_35mm_format,
      f_number,
      iso,
      exposure_time,
      exposure_compensation,
      location_name,
      latitude,
      longitude,
      film_simulation,
      priority_order,
      hidden,
      taken_at,
      taken_at_naive
    )
    VALUES (
      ${photo.id},
      ${photo.url},
      ${photo.extension},
      ${photo.aspectRatio},
      ${photo.blurData},
      ${photo.title},
      ${photo.caption},
      ${photo.semanticDescription},
      ${convertArrayToPostgresString(photo.tags)},
      ${photo.make},
      ${photo.model},
      ${photo.focalLength},
      ${photo.focalLengthIn35MmFormat},
      ${photo.fNumber},
      ${photo.iso},
      ${photo.exposureTime},
      ${photo.exposureCompensation},
      ${photo.locationName},
      ${photo.latitude},
      ${photo.longitude},
      ${photo.filmSimulation},
      ${photo.priorityOrder},
      ${photo.hidden},
      ${photo.takenAt},
      ${photo.takenAtNaive}
    )
  `, 'sqlInsertPhoto');

export const sqlUpdatePhoto = (photo: PhotoDbInsert) =>
  safelyQueryPhotos(() => sql`
    UPDATE photos SET
    url=${photo.url},
    extension=${photo.extension},
    aspect_ratio=${photo.aspectRatio},
    blur_data=${photo.blurData},
    title=${photo.title},
    caption=${photo.caption},
    semantic_description=${photo.semanticDescription},
    tags=${convertArrayToPostgresString(photo.tags)},
    make=${photo.make},
    model=${photo.model},
    focal_length=${photo.focalLength},
    focal_length_in_35mm_format=${photo.focalLengthIn35MmFormat},
    f_number=${photo.fNumber},
    iso=${photo.iso},
    exposure_time=${photo.exposureTime},
    exposure_compensation=${photo.exposureCompensation},
    location_name=${photo.locationName},
    latitude=${photo.latitude},
    longitude=${photo.longitude},
    film_simulation=${photo.filmSimulation},
    priority_order=${photo.priorityOrder || null},
    hidden=${photo.hidden},
    taken_at=${photo.takenAt},
    taken_at_naive=${photo.takenAtNaive},
    updated_at=${(new Date()).toISOString()}
    WHERE id=${photo.id}
  `, 'sqlUpdatePhoto');

export const sqlDeletePhotoTagGlobally = (tag: string) =>
  safelyQueryPhotos(() => sql`
    UPDATE photos
    SET tags=ARRAY_REMOVE(tags, ${tag})
    WHERE ${tag}=ANY(tags)
  `, 'sqlDeletePhotoTagGlobally');

export const sqlRenamePhotoTagGlobally = (tag: string, updatedTag: string) =>
  safelyQueryPhotos(() => sql`
    UPDATE photos
    SET tags=ARRAY_REPLACE(tags, ${tag}, ${updatedTag})
    WHERE ${tag}=ANY(tags)
  `, 'sqlRenamePhotoTagGlobally');

export const sqlDeletePhoto = (id: string) =>
  safelyQueryPhotos(
    () => sql`DELETE FROM photos WHERE id=${id}`,
    'sqlDeletePhoto',
  );

const sqlGetPhoto = (id: string, includeHidden?: boolean) => includeHidden
  ? sql<PhotoDb>`SELECT * FROM photos WHERE id=${id} LIMIT 1`
  // eslint-disable-next-line max-len
  : sql<PhotoDb>`SELECT * FROM photos WHERE id=${id} AND hidden IS NOT TRUE LIMIT 1`;

const sqlGetPhotosCount = async () => sql`
  SELECT COUNT(*) FROM photos
  WHERE hidden IS NOT TRUE
`.then(({ rows }) => parseInt(rows[0].count, 10));

const sqlGetPhotosCountIncludingHidden = async () => sql`
  SELECT COUNT(*) FROM photos
`.then(({ rows }) => parseInt(rows[0].count, 10));

const sqlGetPhotosMostRecentUpdate = async () => sql`
  SELECT updated_at FROM photos ORDER BY updated_at DESC LIMIT 1
`.then(({ rows }) => rows[0] ? rows[0].updated_at as Date : undefined);

const sqlGetPhotosDateRange = async () => sql`
  SELECT MIN(taken_at_naive) as start, MAX(taken_at_naive) as end
  FROM photos
  WHERE hidden IS NOT TRUE
`.then(({ rows }) => rows[0]?.start && rows[0]?.end
    ? rows[0] as PhotoDateRange
    : undefined);

const sqlGetPhotosCameraMeta = async (camera: Camera) => sql`
  SELECT COUNT(*), MIN(taken_at_naive) as start, MAX(taken_at_naive) as end
  FROM photos
  WHERE
  LOWER(REPLACE(make, ' ', '-'))=${parameterize(camera.make, true)} AND
  LOWER(REPLACE(model, ' ', '-'))=${parameterize(camera.model, true)} AND
  hidden IS NOT TRUE
`.then(({ rows }) => ({
    count: parseInt(rows[0].count, 10),
    ...rows[0]?.start && rows[0]?.end
      ? { dateRange: rows[0] as PhotoDateRange }
      : undefined,
  }));

const sqlGetPhotosFilmSimulationMeta = async (
  simulation: FilmSimulation,
) => sql`
  SELECT COUNT(*), MIN(taken_at_naive) as start, MAX(taken_at_naive) as end
  FROM photos
  WHERE film_simulation=${simulation} AND
  hidden IS NOT TRUE
`.then(({ rows }) => ({
    count: parseInt(rows[0].count, 10),
    ...rows[0]?.start && rows[0]?.end
      ? { dateRange: rows[0] as PhotoDateRange }
      : undefined,
  }));

const sqlGetUniqueTags = async () => sql`
  SELECT DISTINCT unnest(tags) as tag, COUNT(*)
  FROM photos
  WHERE hidden IS NOT TRUE
  GROUP BY tag
  ORDER BY tag ASC
`.then(({ rows }): TagsWithMeta => rows.map(({ tag, count }) => ({
    tag: tag as string,
    count: parseInt(count, 10),
  })));

const sqlGetUniqueTagsHidden = async () => sql`
  SELECT DISTINCT unnest(tags) as tag, COUNT(*)
  FROM photos
  GROUP BY tag
  ORDER BY tag ASC
`.then(({ rows }): TagsWithMeta => rows.map(({ tag, count }) => ({
    tag: tag as string,
    count: parseInt(count, 10),
  })));

const sqlGetUniqueCameras = async () => sql`
  SELECT DISTINCT make||' '||model as camera, make, model, COUNT(*)
  FROM photos
  WHERE hidden IS NOT TRUE
  AND trim(make) <> ''
  AND trim(model) <> ''
  GROUP BY make, model
  ORDER BY camera ASC
`.then(({ rows }): Cameras => rows.map(({ make, model, count }) => ({
    cameraKey: createCameraKey({ make, model }),
    camera: { make, model },
    count: parseInt(count, 10),
  })));

const sqlGetUniqueFilmSimulations = async () => sql`
  SELECT DISTINCT film_simulation, COUNT(*)
  FROM photos
  WHERE hidden IS NOT TRUE AND film_simulation IS NOT NULL
  GROUP BY film_simulation
  ORDER BY film_simulation ASC
`.then(({ rows }): FilmSimulations => rows
    .map(({ film_simulation, count }) => ({
      simulation: film_simulation as FilmSimulation,
      count: parseInt(count, 10),
    })));

export type GetPhotosOptions = {
  sortBy?: 'createdAt' | 'takenAt' | 'priority'
  limit?: number
  offset?: number
  query?: string
  tag?: string
  camera?: Camera
  simulation?: FilmSimulation
  takenBefore?: Date
  takenAfterInclusive?: Date
  hidden?: 'exclude' | 'include' | 'only'
}

const safelyQueryPhotos = async <T>(
  callback: () => Promise<T>,
  debugMessage: string
): Promise<T> => {
  let result: T;

  const start = new Date();

  try {
    result = await callback();
  } catch (e: any) {
    if (MIGRATION_FIELDS_01.some(field => new RegExp(
      `column "${field}" of relation "photos" does not exist`,
      'i',
    ).test(e.message))) {
      console.log('Running migration 01 ...');
      await sqlRunMigration01();
      result = await callback();
    } else if (/relation "photos" does not exist/i.test(e.message)) {
      // If the table does not exist, create it
      console.log('Creating photos table ...');
      await sqlCreatePhotosTable();
      result = await callback();
    } else if (/endpoint is in transition/i.test(e.message)) {
      console.log('sql get error: endpoint is in transition (setting timeout)');
      // Wait 5 seconds and try again
      await new Promise(resolve => setTimeout(resolve, 5000));
      try {
        result = await callback();
      } catch (e: any) {
        console.log(`sql get error on retry (after 5000ms): ${e.message} `);
        throw e;
      }
    } else {
      console.log(`sql get error: ${e.message} `);
      throw e;
    }
  }

  if (SHOULD_DEBUG_SQL && debugMessage) {
    const time =
      (((new Date()).getTime() - start.getTime()) / 1000).toFixed(2);
    console.log(`Executing sql query: ${debugMessage} (${time} seconds)`);
  }

  return result;
};

const getWheresFromOptions = (
  options: GetPhotosOptions,
  initialValuesIndex = 1,
) => {
  const {
    hidden = 'exclude',
    takenBefore,
    takenAfterInclusive,
    query,
    tag,
    camera,
    simulation,
  } = options;

  const wheres = [] as string[];
  const wheresValues = [] as (string | number)[];
  let valuesIndex = initialValuesIndex;

  switch (hidden) {
  case 'exclude':
    wheres.push('hidden IS NOT TRUE');
    break;
  case 'only':
    wheres.push('hidden IS TRUE');
    break;
  }
  if (takenBefore) {
    wheres.push(`taken_at > $${valuesIndex++}`);
    wheresValues.push(takenBefore.toISOString());
  }
  if (takenAfterInclusive) {
    wheres.push(`taken_at <= $${valuesIndex++}`);
    wheresValues.push(takenAfterInclusive.toISOString());
  }
  if (query) {
    // eslint-disable-next-line max-len
    wheres.push(`CONCAT(title, ' ', caption, ' ', semantic_description) ILIKE $${valuesIndex++}`);
    wheresValues.push(`%${query.toLocaleLowerCase()}%`);
  }
  if (tag) {
    wheres.push(`$${valuesIndex++}=ANY(tags)`);
    wheresValues.push(tag);
  }
  if (camera) {
    wheres.push(`LOWER(REPLACE(make, ' ', '-'))=$${valuesIndex++}`);
    wheres.push(`LOWER(REPLACE(model, ' ', '-'))=$${valuesIndex++}`);
    wheresValues.push(parameterize(camera.make, true));
    wheresValues.push(parameterize(camera.model, true));
  }
  if (simulation) {
    wheres.push(`film_simulation=$${valuesIndex++}`);
    wheresValues.push(simulation);
  }

  return {
    wheres: wheres.length > 0
      ? `WHERE ${wheres.join(' AND ')}`
      : '',
    wheresValues,
    lastValuesIndex: valuesIndex,
  };
};

const getOrderByFromOptions = (options: GetPhotosOptions) => {
  const {
    sortBy = PRIORITY_ORDER_ENABLED ? 'priority' : 'takenAt',
  } = options;

  switch (sortBy) {
  case 'createdAt':
    return 'ORDER BY created_at DESC';
  case 'takenAt':
    return 'ORDER BY taken_at DESC';
  case 'priority':
    return 'ORDER BY priority_order ASC, taken_at DESC';
  }
};

const getLimitAndOffsetFromOptions = (
  options: GetPhotosOptions,
  initialValuesIndex = 1,
) => {
  const {
    limit = PHOTO_DEFAULT_LIMIT,
    offset = 0,
  } = options;

  let valuesIndex = initialValuesIndex;

  return {
    limitAndOffset: `LIMIT $${valuesIndex++} OFFSET $${valuesIndex++}`,
    limitAndOffsetValues: [limit, offset],
  };
};

export const getPhotos = async (options: GetPhotosOptions = {}) =>
  safelyQueryPhotos(async () => {
    const sql = ['SELECT * FROM photos'];
    const values = [] as (string | number)[];

    const {
      wheres,
      wheresValues,
      lastValuesIndex,
    } = getWheresFromOptions(options);

    let valuesIndex = lastValuesIndex;
    
    if (wheres) {
      sql.push(wheres);
      values.push(...wheresValues);
    }

    sql.push(getOrderByFromOptions(options));

    const {
      limitAndOffset,
      limitAndOffsetValues,
    } = getLimitAndOffsetFromOptions(options, valuesIndex);

    // LIMIT + OFFSET
    sql.push(limitAndOffset);
    values.push(...limitAndOffsetValues);

    return query(sql.join(' '), values);
  }, 'getPhotos')
    .then(({ rows }) => rows.map(parsePhotoFromDb));

export const getPhotosNearId = async (
  photoId: string,
  options: GetPhotosOptions,
) =>
  safelyQueryPhotos(async () => {
    const { limit } = options;

    const {
      wheres,
      wheresValues,
      lastValuesIndex,
    } = getWheresFromOptions(options);

    let valuesIndex = lastValuesIndex;

    return query(
      `
        WITH twi AS (
          SELECT *, row_number()
          OVER (${getOrderByFromOptions(options)}) as row_number
          FROM photos
          ${wheres}
        ),
        current AS (SELECT row_number FROM twi WHERE id = $${valuesIndex++})
        SELECT twi.*
        FROM twi, current
        WHERE twi.row_number >= current.row_number - 1
        LIMIT $${valuesIndex++}
      `,
      [...wheresValues, photoId, limit]
    );
  }, `getPhotosNearId: ${photoId}`)
    .then(({ rows }) => {
      const photo = rows.find(({ id }) => id === photoId);
      const indexNumber = photo ? parseInt(photo.row_number) : undefined;
      return {
        photos: rows.map(parsePhotoFromDb),
        indexNumber,
      };
    });

export const getPhotosMeta = (options: GetPhotosOptions = {}) =>
  safelyQueryPhotos(async () => {
    // eslint-disable-next-line max-len
    let sql = 'SELECT COUNT(*), MIN(taken_at_naive) as start, MAX(taken_at_naive) as end FROM photos';
    const { wheres, wheresValues } = getWheresFromOptions(options);
    if (wheres) { sql += ` ${wheres}`; }
    return query(sql, wheresValues);
  }, 'getPhotosMeta')
    .then(({ rows }) => ({
      count: parseInt(rows[0].count, 10),
      ...rows[0]?.start && rows[0]?.end
        ? { dateRange: rows[0] as PhotoDateRange }
        : undefined,
    }));

export const getPhotoIds = async ({ limit }: { limit?: number }) =>
  safelyQueryPhotos(() => limit
    ? sql`SELECT id FROM photos LIMIT ${limit}`
    : sql`SELECT id FROM photos`,
  'getPhotoIds')
    .then(({ rows }) => rows.map(({ id }) => id as string));

export const getPhoto = async (
  id: string,
  includeHidden?: boolean,
): Promise<Photo | undefined> => {
  // Check for photo id forwarding
  // and convert short ids to uuids
  const photoId = translatePhotoId(id);
  return safelyQueryPhotos(() =>
    sqlGetPhoto(photoId, includeHidden), 'sqlGetPhoto')
    .then(({ rows }) => rows.map(parsePhotoFromDb))
    .then(photos => photos.length > 0 ? photos[0] : undefined);
};
export const getPhotosDateRange = () =>
  safelyQueryPhotos(sqlGetPhotosDateRange, 'getPhotosDateRange');
export const getPhotosCount = () =>
  safelyQueryPhotos(sqlGetPhotosCount, 'getPhotosCount');
export const getPhotosCountIncludingHidden = () =>
  safelyQueryPhotos(
    sqlGetPhotosCountIncludingHidden,
    'getPhotosCountIncludingHidden',
  );
export const getPhotosMostRecentUpdate = () =>
  safelyQueryPhotos(
    sqlGetPhotosMostRecentUpdate,
    'getPhotosMostRecentUpdate',
  );

// TAGS
export const getUniqueTags = () =>
  safelyQueryPhotos(sqlGetUniqueTags, 'getUniqueTags');
export const getUniqueTagsHidden = () =>
  safelyQueryPhotos(sqlGetUniqueTagsHidden, 'getUniqueTagsHidden');

// CAMERAS
export const getUniqueCameras = () =>
  safelyQueryPhotos(sqlGetUniqueCameras, 'getUniqueCameras');
export const getPhotosCameraMeta = (camera: Camera) =>
  safelyQueryPhotos(
    () => sqlGetPhotosCameraMeta(camera),
    'getPhotosCameraMeta',
  );

// FILM SIMULATIONS
export const getUniqueFilmSimulations = () =>
  safelyQueryPhotos(sqlGetUniqueFilmSimulations, 'getUniqueFilmSimulations');
export const getPhotosFilmSimulationMeta =
  (simulation: FilmSimulation) => safelyQueryPhotos(
    () => sqlGetPhotosFilmSimulationMeta(simulation),
    'getPhotosFilmSimulationMeta',
  );
