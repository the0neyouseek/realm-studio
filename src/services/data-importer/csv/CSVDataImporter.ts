import fs = require('fs-extra');
import fsExtra = require('fs-extra');
import papaparse = require('papaparse');
import * as fsPath from 'path';
import { DataImporter } from '../DataImporter';

export class CSVDataImporter extends DataImporter {
  private static readonly NUMBER_OF_INSERTS_BEFORE_COMMIT = 10000;

  public importInto(realm: Realm) {
    this.files.map((file, index) => {
      const schema = this.importSchema[index];

      const rawCSV = fs.readFileSync(file, 'utf8');
      const data = papaparse.parse(rawCSV, {
        header: true, // to avoid parsing first line as data
        skipEmptyLines: true,
      }).data;

      realm.beginTransaction();
      let numberOfInsert = 0;
      data.forEach((row, lineIndex: number) => {
        const object: any = {};
        for (const prop in schema.properties) {
          if (schema.properties.hasOwnProperty(prop) && row[prop]) {
            try {
              switch (schema.properties[prop]) {
                case 'bool?':
                  object[prop] = JSON.parse(row[prop].toLocaleLowerCase());
                  break;
                case 'int?':
                  const intNumber = parseInt(row[prop], 10);
                  if (isNaN(intNumber)) {
                    throw new Error(
                      `Can not parse ${row[prop]} as int at line ${lineIndex}`,
                    );
                  }
                  object[prop] = intNumber;
                  break;
                case 'double?':
                  const floatNumber = parseFloat(row[prop]);
                  if (isNaN(floatNumber)) {
                    throw new Error(
                      `Can not parse ${row[prop]} as int at line ${lineIndex}`,
                    );
                  }
                  object[prop] = floatNumber;
                  break;
                default:
                  // string?
                  object[prop] = row[prop];
              }
            } catch (e) {
              // abort transaction and delete the Realm
              realm.cancelTransaction();
              throw new Error(
                `Parsing error at line ${lineIndex}, expected type "${schema
                  .properties[prop]}" but got "${row[
                  prop
                ]}" for column "${prop}"\nError details: ${e}`,
              );
            }
          }
        }

        try {
          realm.create(schema.name, object);
        } catch (e) {
          // This might throw, if the CSV violate the current Realm constraints (ex: nullability or primary key)
          // or generally if the CSV schema is not compatible with the current Realm.
          realm.cancelTransaction();
          throw e;
        }

        numberOfInsert++;

        // commit by batch to avoid creating multiple transactions.
        if (
          numberOfInsert === CSVDataImporter.NUMBER_OF_INSERTS_BEFORE_COMMIT
        ) {
          realm.commitTransaction();
          numberOfInsert = 0;
          realm.beginTransaction();
        }
      });

      realm.commitTransaction();
    });
  }

  public import(path: string): Realm {
    const realm = this.createNewRealmFile(path);
    try {
      this.importInto(realm);
    } catch (e) {
      realm.close();
      // in case of an error remove the created Realm
      fsExtra.removeSync(realm.path);
      throw e;
    }
    return realm;
  }
}