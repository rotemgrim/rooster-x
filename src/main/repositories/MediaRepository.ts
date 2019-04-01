import {Service} from "typedi";
import {Connection} from "typeorm";
import {InjectConnection} from "typeorm-typedi-extensions";
import {MetaData} from "../../entity/MetaData";

@Service()
export class MediaRepository {

    @InjectConnection("reading")
    private connection: Connection;

    public getAllMedia() {
        const metaRepo = this.connection.manager.getRepository(MetaData);
        return metaRepo.find();
    }

    public query(repository: any, q?: any) {
        const metaRepo = this.connection.manager.getRepository(repository);
        return metaRepo.find(q);
    }
}
